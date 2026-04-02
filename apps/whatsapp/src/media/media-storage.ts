/**
 * MinIO media storage for WhatsApp inbound media messages.
 * Downloads media from Baileys buffer, uploads to MinIO,
 * returns a permanent public URL.
 */
import { Client as MinioClient } from 'minio';
import { randomUUID } from 'crypto';
import pino from 'pino';

const logger = pino({ level: process.env.LOG_LEVEL ?? 'info' });

const BUCKET = process.env.MINIO_BUCKET ?? 'wacrm-media';

let client: MinioClient | null = null;

function getClient(): MinioClient {
  if (!client) {
    client = new MinioClient({
      endPoint: process.env.MINIO_ENDPOINT ?? 'localhost',
      port: Number(process.env.MINIO_PORT ?? 9000),
      useSSL: process.env.MINIO_USE_SSL === 'true',
      accessKey: process.env.MINIO_ACCESS_KEY ?? 'minioadmin',
      secretKey: process.env.MINIO_SECRET_KEY ?? 'minioadmin',
    });
  }
  return client;
}

export async function ensureBucket(): Promise<void> {
  const minio = getClient();
  const exists = await minio.bucketExists(BUCKET);
  if (!exists) {
    await minio.makeBucket(BUCKET, process.env.MINIO_REGION ?? 'us-east-1');
    // Set public read policy
    const policy = JSON.stringify({
      Version: '2012-10-17',
      Statement: [{
        Effect: 'Allow',
        Principal: { AWS: ['*'] },
        Action: ['s3:GetObject'],
        Resource: [`arn:aws:s3:::${BUCKET}/*`],
      }],
    });
    await minio.setBucketPolicy(BUCKET, policy);
    logger.info({ bucket: BUCKET }, 'MinIO bucket created');
  }
}

/**
 * Upload a media buffer to MinIO and return the public URL.
 * @param buffer  Raw media bytes
 * @param mimeType  e.g. 'image/jpeg', 'video/mp4', 'audio/ogg'
 * @param extension  e.g. 'jpg', 'mp4'
 */
export async function uploadMedia(
  buffer: Buffer,
  mimeType: string,
  extension: string,
): Promise<string> {
  const minio = getClient();
  const objectName = `${new Date().toISOString().slice(0, 10)}/${randomUUID()}.${extension}`;

  await minio.putObject(BUCKET, objectName, buffer, buffer.length, {
    'Content-Type': mimeType,
    'Cache-Control': 'max-age=31536000',
  });

  const baseUrl = process.env.MINIO_PUBLIC_URL ?? `http://${process.env.MINIO_ENDPOINT ?? 'localhost'}:${process.env.MINIO_PORT ?? 9000}`;
  return `${baseUrl}/${BUCKET}/${objectName}`;
}

/** Derive file extension from MIME type */
export function mimeToExtension(mimeType: string): string {
  const map: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'video/mp4': 'mp4',
    'video/3gpp': '3gp',
    'audio/ogg': 'ogg',
    'audio/mpeg': 'mp3',
    'audio/mp4': 'm4a',
    'application/pdf': 'pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  };
  return map[mimeType] ?? 'bin';
}
