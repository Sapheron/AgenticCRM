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
import { jidToPhone } from '@wacrm/shared';
import { getLastInboundAt, setInboundBaseline, clearInboundActivity } from './activity';

const logger = pino({ level: process.env.LOG_LEVEL ?? 'info' });

// Active socket map: accountId → WASocket
const activeSockets = new Map<string, WASocket>();
// Active monitor map: accountId → InboundMonitor (for cleanup on reconnect)
const activeMonitors = new Map<string, InboundMonitor>();

// Stale connection watchdog config (matches OpenClaw's defaults)
const WATCHDOG_CHECK_MS = 2 * 60 * 1000;  // check every 2 minutes
const STALE_TIMEOUT_MS = 5 * 60 * 1000;   // force reconnect if no activity for 5 minutes

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
      browser: ['AgenticCRM', 'Chrome', '124.0.0'],
      markOnlineOnConnect: false, // prevents "online" status spam
      keepAliveIntervalMs: 30_000, // send WebSocket ping every 30s to prevent silent disconnects
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
        const phone = sock.user?.id ? jidToPhone(sock.user.id) : '';
        const displayName = sock.user?.name ?? '';
        logger.info({ accountId, phone }, 'WhatsApp connected');

        // CRITICAL: Send "available" presence on connect (OpenClaw: monitor.ts:108-111)
        // Without this, WhatsApp considers the session inactive and stops delivering messages.
        // This is the root cause of "works for 5 minutes then stops listening".
        try {
          await sock.sendPresenceUpdate('available');
          logger.info({ accountId }, 'Sent presence "available" on connect');
        } catch (err) {
          logger.warn({ accountId, err }, 'Failed to send presence update');
        }

        // Mark connection time as initial activity baseline (OpenClaw pattern)
        setInboundBaseline(accountId);

        // Auto-add connected number to allowlist if empty (first connection default)
        const existing = await prisma.whatsAppAccount.findUnique({
          where: { id: accountId },
          select: { allowedNumbers: true },
        });
        const shouldSeedAllowlist = !existing?.allowedNumbers?.length && phone;

        await prisma.whatsAppAccount.update({
          where: { id: accountId },
          data: {
            status: 'CONNECTED',
            phoneNumber: phone,
            displayName,
            qrCode: null,
            consecutiveErrors: 0,
            lastConnectedAt: new Date(),
            ...(shouldSeedAllowlist ? { allowedNumbers: [phone] } : {}),
          },
        });

        await publishConnected(accountId, phone, displayName);
      }

      if (connection === 'close') {
        activeSockets.delete(accountId);
        // Clean up old monitor's Redis/BullMQ connections (OpenClaw: closeCurrentConnection)
        const oldMonitor = activeMonitors.get(accountId);
        if (oldMonitor) {
          await oldMonitor.close().catch(() => null);
          activeMonitors.delete(accountId);
        }
        const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const reason = (DisconnectReason as any)[statusCode] ?? 'unknown';

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

        await publishDisconnected(accountId, String(reason));

        if (shouldReconnect) {
          const backoffMs = Math.min(5000 * 2 ** (await getConsecutiveErrors(accountId)), 60000);
          logger.info({ accountId, backoffMs }, 'Reconnecting after backoff');
          setTimeout(() => void connect(), backoffMs);
        }
      }
    });

    // ── Inbound messages ────────────────────────────────────────
    // Clean up any previous monitor before creating a new one
    const prevMonitor = activeMonitors.get(accountId);
    if (prevMonitor) {
      await prevMonitor.close().catch(() => null);
    }
    const monitor = new InboundMonitor(sock, accountId);
    activeMonitors.set(accountId, monitor);
    await monitor.init();
    monitor.start();
  };

  await connect();
}

export async function stopSession(accountId: string, logout = false): Promise<void> {
  const sock = activeSockets.get(accountId);
  if (!sock) return;

  activeSockets.delete(accountId);
  if (logout) {
    await sock.logout();
  } else {
    sock.end(undefined);
  }
  await prisma.whatsAppAccount.update({
    where: { id: accountId },
    data: {
      status: 'DISCONNECTED',
      qrCode: null,
      ...(logout ? { sessionDataEnc: null } : {}),
    },
  });

  logger.info({ accountId, logout }, 'Session stopped');
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

  // Watchdog: every 2 minutes, check for:
  // 1. CONNECTED accounts that lost their socket (silent disconnect)
  // 2. Stale connections — socket exists but no inbound activity for 5+ minutes
  //    (matches OpenClaw's WhatsAppConnectionController.watchdogTimer)
  setInterval(async () => {
    try {
      const connected = await prisma.whatsAppAccount.findMany({
        where: { status: 'CONNECTED' },
        select: { id: true },
      });
      for (const acc of connected) {
        const sock = activeSockets.get(acc.id);
        if (!sock) {
          // Case 1: Socket completely missing
          logger.warn({ accountId: acc.id }, 'Watchdog: socket missing for CONNECTED account — reconnecting');
          await startSession(acc.id).catch((err: unknown) =>
            logger.error({ accountId: acc.id, err }, 'Watchdog reconnect failed'),
          );
        } else {
          // Case 2: Socket exists but stale — no inbound activity
          // OpenClaw force-closes stale sockets to trigger reconnect
          const lastActivity = getLastInboundAt(acc.id);
          const staleMs = Date.now() - lastActivity;
          if (lastActivity > 0 && staleMs > STALE_TIMEOUT_MS) {
            logger.warn(
              { accountId: acc.id, staleSec: Math.round(staleMs / 1000) },
              'Watchdog: stale connection (no inbound activity) — force reconnecting',
            );
            activeSockets.delete(acc.id);
            clearInboundActivity(acc.id);
            try { sock.end(undefined); } catch { /* ignore */ }
            await startSession(acc.id).catch((err: unknown) =>
              logger.error({ accountId: acc.id, err }, 'Watchdog stale reconnect failed'),
            );
          }
        }
      }
    } catch (err: unknown) {
      logger.warn({ err }, 'Watchdog check failed');
    }
  }, WATCHDOG_CHECK_MS);
}
