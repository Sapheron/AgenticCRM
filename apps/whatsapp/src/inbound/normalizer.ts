/**
 * Normalize a raw WAMessage into our internal InternalMessage format.
 */
import type { WAMessage } from '@whiskeysockets/baileys';
import { jidToPhone } from '@wacrm/shared';

export interface InternalMessage {
  whatsappMessageId: string;
  fromPhone: string;        // E.164 without +
  fromJid: string;
  displayName?: string;
  body?: string;
  mediaType?: 'image' | 'video' | 'audio' | 'document' | 'sticker';
  mediaData?: { mimetype: string; url?: string; caption?: string };
  location?: { latitude: number; longitude: number };
  isGroup: boolean;
  timestampMs: number;
}

export function normalizeMessage(msg: WAMessage): InternalMessage | null {
  const key = msg.key;
  if (!key.id || key.fromMe) return null; // skip our own outbound messages

  const jid = key.remoteJid ?? '';
  const isGroup = jid.endsWith('@g.us');
  if (isGroup) return null; // skip group messages for now

  const fromJid = key.participant ?? jid;
  const fromPhone = jidToPhone(fromJid);

  const content = msg.message;
  if (!content) return null;

  let body: string | undefined;
  let mediaType: InternalMessage['mediaType'];
  let mediaData: InternalMessage['mediaData'];
  let location: InternalMessage['location'];

  if (content.conversation) {
    body = content.conversation;
  } else if (content.extendedTextMessage?.text) {
    body = content.extendedTextMessage.text;
  } else if (content.imageMessage) {
    mediaType = 'image';
    mediaData = {
      mimetype: content.imageMessage.mimetype ?? 'image/jpeg',
      caption: content.imageMessage.caption ?? undefined,
    };
    body = content.imageMessage.caption ?? undefined;
  } else if (content.videoMessage) {
    mediaType = 'video';
    mediaData = { mimetype: content.videoMessage.mimetype ?? 'video/mp4', caption: content.videoMessage.caption ?? undefined };
    body = content.videoMessage.caption ?? undefined;
  } else if (content.audioMessage) {
    mediaType = 'audio';
    mediaData = { mimetype: content.audioMessage.mimetype ?? 'audio/ogg' };
  } else if (content.documentMessage) {
    mediaType = 'document';
    mediaData = { mimetype: content.documentMessage.mimetype ?? 'application/octet-stream', caption: content.documentMessage.caption ?? undefined };
  } else if (content.stickerMessage) {
    mediaType = 'sticker';
    mediaData = { mimetype: content.stickerMessage.mimetype ?? 'image/webp' };
  } else if (content.locationMessage) {
    location = {
      latitude: content.locationMessage.degreesLatitude ?? 0,
      longitude: content.locationMessage.degreesLongitude ?? 0,
    };
  }

  const pushName = msg.pushName ?? undefined;
  const timestampMs = typeof msg.messageTimestamp === 'number'
    ? msg.messageTimestamp * 1000
    : Number(msg.messageTimestamp ?? Date.now());

  return {
    whatsappMessageId: key.id,
    fromPhone,
    fromJid,
    displayName: pushName,
    body,
    mediaType,
    mediaData,
    location,
    isGroup,
    timestampMs,
  };
}
