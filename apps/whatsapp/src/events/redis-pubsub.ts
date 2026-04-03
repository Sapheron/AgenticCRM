import Redis from 'ioredis';

const redisUrl = process.env.REDIS_URL!;

export const publisher = new Redis(redisUrl, { lazyConnect: true });

export const CHANNELS = {
  WA_QR: (accountId: string) => `wa:qr:${accountId}`,
  WA_STATUS: (accountId: string) => `wa:status:${accountId}`,
  WA_CONNECTED: (accountId: string) => `wa:connected:${accountId}`,
  WA_DISCONNECTED: (accountId: string) => `wa:disconnected:${accountId}`,
  INBOUND_MESSAGE: 'wa:inbound',
} as const;

export async function publishQr(accountId: string, qrCode: string) {
  await publisher.publish(CHANNELS.WA_QR(accountId), JSON.stringify({ accountId, qrCode }));
}

export async function publishConnected(
  accountId: string,
  phoneNumber: string,
  displayName: string,
) {
  await publisher.publish(
    CHANNELS.WA_CONNECTED(accountId),
    JSON.stringify({ accountId, phoneNumber, displayName }),
  );
}

export async function publishDisconnected(accountId: string, reason: string) {
  await publisher.publish(
    CHANNELS.WA_DISCONNECTED(accountId),
    JSON.stringify({ accountId, reason }),
  );
}

export async function publishInboundMessage(payload: Record<string, unknown>) {
  await publisher.publish(CHANNELS.INBOUND_MESSAGE, JSON.stringify(payload));
}
