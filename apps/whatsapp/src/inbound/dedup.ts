/**
 * Idempotency check: skip already-processed WhatsApp message IDs.
 * Uses the Message.whatsappMessageId unique index.
 */
import { prisma } from '@wacrm/database';

export async function isAlreadyProcessed(whatsappMessageId: string): Promise<boolean> {
  const existing = await prisma.message.findFirst({
    where: { whatsappMessageId },
    select: { id: true },
  });
  return !!existing;
}
