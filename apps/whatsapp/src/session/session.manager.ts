/**
 * Session Manager — one BaileysSession per WhatsApp account.
 * OpenClaw-inspired: per-account isolation, watchdog reconnect loop,
 * Redis pub/sub for QR streaming to the API/dashboard.
 */
import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  type WASocket,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import pino from 'pino';
import { prisma } from '@wacrm/database';
import { usePostgresAuthState } from './session.store';
import { publishQr, publishConnected, publishDisconnected } from '../events/redis-pubsub';
import { InboundMonitor } from '../inbound/monitor';

const logger = pino({ level: process.env.LOG_LEVEL ?? 'info' });

// Active socket map: accountId → WASocket
const activeSockets = new Map<string, WASocket>();

export async function startSession(accountId: string): Promise<void> {
  if (activeSockets.has(accountId)) {
    logger.info({ accountId }, 'Session already active, skipping');
    return;
  }

  logger.info({ accountId }, 'Starting WhatsApp session');
  await prisma.whatsAppAccount.update({
    where: { id: accountId },
    data: { status: 'QR_PENDING' },
  });

  const connect = async () => {
    const { state, saveCreds } = await usePostgresAuthState(accountId);
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
      version,
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, logger as unknown as Parameters<typeof makeCacheableSignalKeyStore>[1]),
      },
      printQRInTerminal: false,
      logger: logger.child({ accountId }) as unknown as Parameters<typeof makeWASocket>[0]['logger'],
      browser: ['WhatsApp AI CRM', 'Chrome', '124.0.0'],
      markOnlineOnConnect: false, // prevents "online" status spam
    });

    activeSockets.set(accountId, sock);

    // ── Credentials update ──────────────────────────────────────
    sock.ev.on('creds.update', saveCreds);

    // ── QR code streaming ───────────────────────────────────────
    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        logger.info({ accountId }, 'QR code received, publishing to Redis');
        await prisma.whatsAppAccount.update({ where: { id: accountId }, data: { qrCode: qr, status: 'QR_PENDING' } });
        await publishQr(accountId, qr);
      }

      if (connection === 'open') {
        const phone = sock.user?.id?.split(':')[0] ?? '';
        const displayName = sock.user?.name ?? '';
        logger.info({ accountId, phone }, 'WhatsApp connected');

        await prisma.whatsAppAccount.update({
          where: { id: accountId },
          data: {
            status: 'CONNECTED',
            phoneNumber: phone,
            displayName,
            qrCode: null,
            consecutiveErrors: 0,
            lastConnectedAt: new Date(),
          },
        });

        await publishConnected(accountId, phone, displayName);
      }

      if (connection === 'close') {
        activeSockets.delete(accountId);
        const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
        const reason = DisconnectReason[statusCode as keyof typeof DisconnectReason] ?? 'unknown';

        logger.warn({ accountId, statusCode, reason }, 'WhatsApp disconnected');

        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

        await prisma.whatsAppAccount.update({
          where: { id: accountId },
          data: {
            status: shouldReconnect ? 'CONNECTING' : 'DISCONNECTED',
            consecutiveErrors: { increment: 1 },
            lastErrorAt: new Date(),
          },
        });

        await publishDisconnected(accountId, reason);

        if (shouldReconnect) {
          const backoffMs = Math.min(5000 * 2 ** (await getConsecutiveErrors(accountId)), 60000);
          logger.info({ accountId, backoffMs }, 'Reconnecting after backoff');
          setTimeout(() => void connect(), backoffMs);
        }
      }
    });

    // ── Inbound messages ────────────────────────────────────────
    const monitor = new InboundMonitor(sock, accountId);
    monitor.start();
  };

  await connect();
}

export async function stopSession(accountId: string): Promise<void> {
  const sock = activeSockets.get(accountId);
  if (!sock) return;

  activeSockets.delete(accountId);
  await sock.logout();
  await prisma.whatsAppAccount.update({
    where: { id: accountId },
    data: { status: 'DISCONNECTED', sessionDataEnc: null, qrCode: null },
  });

  logger.info({ accountId }, 'Session stopped and logged out');
}

export function getSocket(accountId: string): WASocket | undefined {
  return activeSockets.get(accountId);
}

async function getConsecutiveErrors(accountId: string): Promise<number> {
  const acc = await prisma.whatsAppAccount.findUnique({
    where: { id: accountId },
    select: { consecutiveErrors: true },
  });
  return acc?.consecutiveErrors ?? 0;
}

/** On startup: resume all CONNECTED/CONNECTING accounts */
export async function resumeAllSessions(): Promise<void> {
  const accounts = await prisma.whatsAppAccount.findMany({
    where: { status: { in: ['CONNECTED', 'CONNECTING', 'QR_PENDING'] } },
    select: { id: true },
  });

  logger.info({ count: accounts.length }, 'Resuming WhatsApp sessions');
  for (const account of accounts) {
    await startSession(account.id).catch((err: unknown) => {
      logger.error({ accountId: account.id, err }, 'Failed to resume session');
    });
  }
}
