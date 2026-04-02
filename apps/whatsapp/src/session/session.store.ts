/**
 * Baileys auth state persisted to PostgreSQL.
 * Stores encrypted session bytes in WhatsAppAccount.sessionDataEnc.
 */
import type { AuthenticationState } from '@whiskeysockets/baileys';
import { initAuthCreds, BufferJSON, proto } from '@whiskeysockets/baileys';
import { prisma } from '@wacrm/database';

export async function usePostgresAuthState(accountId: string): Promise<{
  state: AuthenticationState;
  saveCreds: () => Promise<void>;
}> {
  const account = await prisma.whatsAppAccount.findUnique({
    where: { id: accountId },
    select: { sessionDataEnc: true },
  });

  let creds: AuthenticationState['creds'];
  let keys: Record<string, Record<string, unknown>> = {};

  if (account?.sessionDataEnc) {
    const parsed = JSON.parse(account.sessionDataEnc.toString(), BufferJSON.reviver) as {
      creds: AuthenticationState['creds'];
      keys: Record<string, Record<string, unknown>>;
    };
    creds = parsed.creds;
    keys = parsed.keys ?? {};
  } else {
    creds = initAuthCreds();
  }

  const saveCreds = async () => {
    const serialized = JSON.stringify({ creds, keys }, BufferJSON.replacer);
    await prisma.whatsAppAccount.update({
      where: { id: accountId },
      data: { sessionDataEnc: Buffer.from(serialized) },
    });
  };

  const state: AuthenticationState = {
    creds,
    keys: {
      get: async (type, ids) => {
        const data: Record<string, unknown> = {};
        for (const id of ids) {
          const value = keys[type]?.[id];
          if (value) {
            data[id] = type === 'app-state-sync-key'
              ? proto.Message.AppStateSyncKeyData.fromObject(value)
              : value;
          }
        }
        return data;
      },
      set: async (data) => {
        for (const [category, categoryData] of Object.entries(data)) {
          if (!keys[category]) keys[category] = {};
          for (const [id, value] of Object.entries(categoryData ?? {})) {
            if (value) {
              keys[category][id] = value;
            } else {
              delete keys[category][id];
            }
          }
        }
        await saveCreds();
      },
    },
  };

  return { state, saveCreds };
}
