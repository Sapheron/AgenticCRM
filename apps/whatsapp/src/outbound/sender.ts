/**
 * Outbound message sender — matches OpenClaw's direct send pattern.
 * No warmup limits, no artificial delays. Retry on connection errors only.
 */
import pino from 'pino';
import { getSocket } from '../session/session.manager';
import { phoneToJid } from '@wacrm/shared';
import { sleep } from '@wacrm/shared';

const logger = pino({ level: process.env.LOG_LEVEL ?? 'info' });

// Retry config matching OpenClaw's sendWithRetry pattern
const MAX_SEND_RETRIES = 3;
const RETRY_BASE_MS = 500;
const RETRYABLE_ERRORS = /closed|reset|timed\s*out|disconnect|no active socket/i;

function isRetryableError(err: unknown): boolean {
  return RETRYABLE_ERRORS.test(String((err as Error)?.message ?? err));
}

export async function sendTextMessage(
  accountId: string,
  toPhone: string,
  text: string,
  directJid?: string,
): Promise<{ success: boolean; waMessageId?: string; error?: string }> {
  const sock = getSocket(accountId);
  if (!sock) {
    return { success: false, error: 'No active session for account' };
  }

  const jid = directJid || phoneToJid(toPhone);

  // Retry loop matching OpenClaw's sendWithRetry (deliver-reply.ts:61-82)
  let lastErr: unknown;
  for (let attempt = 1; attempt <= MAX_SEND_RETRIES; attempt++) {
    try {
      const result = await sock.sendMessage(jid, { text });
      logger.info({ accountId, toPhone, waMessageId: result?.key.id }, 'Message sent');
      return { success: true, waMessageId: result?.key?.id ?? undefined };
    } catch (err: unknown) {
      lastErr = err;
      if (attempt < MAX_SEND_RETRIES && isRetryableError(err)) {
        const backoff = RETRY_BASE_MS * attempt;
        logger.warn({ accountId, toPhone, attempt, backoff }, 'Send failed (retryable) — retrying');
        await sleep(backoff);
        continue;
      }
      break;
    }
  }

  logger.error({ accountId, toPhone, err: lastErr }, 'Failed to send message after retries');
  return { success: false, error: (lastErr as Error).message };
}

export async function sendMediaMessage(
  accountId: string,
  toPhone: string,
  mediaUrl: string,
  mimeType: string,
  caption?: string,
  directJid?: string,
): Promise<{ success: boolean; waMessageId?: string; error?: string }> {
  const sock = getSocket(accountId);
  if (!sock) return { success: false, error: 'No active session' };

  const jid = directJid || phoneToJid(toPhone);
  const isImage = mimeType.startsWith('image/');
  const isVideo = mimeType.startsWith('video/');
  const isAudio = mimeType.startsWith('audio/');

  try {
    let result;
    if (isImage) {
      result = await sock.sendMessage(jid, { image: { url: mediaUrl }, caption });
    } else if (isVideo) {
      result = await sock.sendMessage(jid, { video: { url: mediaUrl }, caption });
    } else if (isAudio) {
      result = await sock.sendMessage(jid, { audio: { url: mediaUrl }, mimetype: mimeType, ptt: true });
    } else {
      result = await sock.sendMessage(jid, { document: { url: mediaUrl }, mimetype: mimeType, caption });
    }

    return { success: true, waMessageId: result?.key?.id ?? undefined };
  } catch (err: unknown) {
    return { success: false, error: (err as Error).message };
  }
}
