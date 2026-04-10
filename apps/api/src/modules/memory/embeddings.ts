/**
 * Embedding clients — calls the company's configured AI provider to embed text.
 *
 * Mirrors how OpenClaw chooses an embedding backend at runtime, but adapted to
 * our PostgreSQL stack:
 *   - OPENAI         → text-embedding-3-small (1536 dims, native)
 *   - GEMINI         → text-embedding-004     (padded/truncated to 1536)
 *   - everything else → null (keyword-only fallback, no embeddings stored)
 *
 * The 1536-dim target is fixed by the pgvector column declared in
 * manual_pgvector.sql. Models that emit different sizes are normalized to
 * 1536 by L2-padding/truncation so they still slot into the same column.
 */
import { decrypt } from '@wacrm/shared';
import { prisma } from '@wacrm/database';

export const EMBEDDING_DIM = 1536;

export interface EmbedResult {
  vector: number[]; // length === EMBEDDING_DIM
  model: string;
}

/** Resolve an embedder for a company. Returns null if no compatible provider is configured. */
export async function getCompanyEmbedder(companyId: string): Promise<((text: string) => Promise<EmbedResult>) | null> {
  const config = await prisma.aiConfig.findUnique({ where: { companyId } });
  if (!config?.apiKeyEncrypted) return null;

  const apiKey = decrypt(config.apiKeyEncrypted);

  switch (config.provider) {
    case 'OPENAI':
      return (text: string) => embedOpenAI(text, apiKey, 'https://api.openai.com/v1');
    case 'GEMINI':
      return (text: string) => embedOpenAI(
        text,
        apiKey,
        'https://generativelanguage.googleapis.com/v1beta/openai',
        'text-embedding-004',
      );
    default:
      return null;
  }
}

async function embedOpenAI(
  text: string,
  apiKey: string,
  baseUrl: string,
  model = 'text-embedding-3-small',
): Promise<EmbedResult> {
  const res = await fetch(`${baseUrl}/embeddings`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model, input: text }),
  });
  if (!res.ok) {
    throw new Error(`Embedding error ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  const json = (await res.json()) as { data?: Array<{ embedding?: number[] }> };
  const vector = json.data?.[0]?.embedding;
  if (!vector?.length) throw new Error('Embedding response missing vector');
  return { vector: normalizeDim(vector), model };
}

/** Pad with zeros or truncate so every vector matches our pgvector(1536) column. */
function normalizeDim(v: number[]): number[] {
  if (v.length === EMBEDDING_DIM) return v;
  if (v.length > EMBEDDING_DIM) return v.slice(0, EMBEDDING_DIM);
  const padded = v.slice();
  while (padded.length < EMBEDDING_DIM) padded.push(0);
  return padded;
}

/** Format a JS number array as a pgvector literal: '[0.1,0.2,...]'. */
export function toPgVector(vector: number[]): string {
  return '[' + vector.join(',') + ']';
}
