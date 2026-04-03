/**
 * WhatsApp service entrypoint.
 * Connects to Redis, resumes all existing WhatsApp sessions,
 * and listens for management commands from the API via Redis pub/sub.
 */
import 'dotenv/config';
import pino from 'pino';
import Redis from 'ioredis';
import { publisher } from './events/redis-pubsub';
import { resumeAllSessions, startSession, stopSession } from './session/session.manager';
import { startOutboundSubscriber } from './outbound/outbound-subscriber';

const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  transport: process.env.NODE_ENV !== 'production'
    ? { target: 'pino-pretty', options: { colorize: true } }
    : undefined,
});

const redisUrl = process.env.REDIS_URL!;

// Commands from API: { command: 'start'|'stop', accountId: string }
const COMMAND_CHANNEL = 'wa:command';

async function main() {
  logger.info('WhatsApp service starting');

  // Connect redis publisher
  await publisher.connect();

  // Subscribe to management commands from API
  const subscriber = new Redis(redisUrl);
  await subscriber.subscribe(COMMAND_CHANNEL);

  subscriber.on('message', (_channel, message) => {
    const { command, accountId } = JSON.parse(message) as { command: string; accountId: string };
    if (command === 'start') {
      void startSession(accountId).catch((err: unknown) => logger.error({ accountId, err }, 'Start session error'));
    } else if (command === 'stop') {
      void stopSession(accountId).catch((err: unknown) => logger.error({ accountId, err }, 'Stop session error'));
    }
  });

  // Start outbound message subscriber (sends AI/agent replies via Baileys)
  startOutboundSubscriber();

  // Resume all active sessions from DB
  await resumeAllSessions();

  logger.info('WhatsApp service ready');

  // Graceful shutdown
  process.on('SIGTERM', async () => {
    logger.info('SIGTERM received, shutting down');
    await subscriber.quit();
    await publisher.quit();
    process.exit(0);
  });
}

main().catch((err: unknown) => {
  logger.error(err, 'Fatal error in WhatsApp service');
  process.exit(1);
});
