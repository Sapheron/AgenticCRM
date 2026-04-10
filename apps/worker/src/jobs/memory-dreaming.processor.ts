/**
 * Memory Dreaming processor — runs every 6 hours.
 *
 * Replicates OpenClaw's `rankShortTermPromotionCandidates`: read RecallEntry
 * rows that have been hit at least 3 times by at least 2 distinct queries,
 * weight them by frequency / relevance / diversity / recency / consolidation
 * / conceptual signals, and promote the top scoring snippets into the
 * long-term `MEMORY.md` file (which is injected into every system prompt).
 *
 * The chunks for the rewritten MEMORY.md are inserted with embedding=NULL.
 * The `textSearch` tsvector column is GENERATED ALWAYS, so the new chunks are
 * still findable via FTS — vector search picks them up next time the API's
 * MemoryService re-indexes the file with embeddings.
 */
import { Worker, Job, Queue } from 'bullmq';
import Redis from 'ioredis';
import pino from 'pino';
import { createHash, randomUUID } from 'crypto';
import { prisma } from '@wacrm/database';
import { QUEUES } from '@wacrm/shared';

const logger = pino({ level: process.env.LOG_LEVEL ?? 'info' });
const connection = new Redis(process.env.REDIS_URL!, { maxRetriesPerRequest: null });

const PROMOTION_SCORE_THRESHOLD = 0.75;
const MIN_RECALL_COUNT = 3;
const MIN_DISTINCT_QUERIES = 2;
const MAX_CANDIDATES_PER_RUN = 50;
const HALF_LIFE_DAYS = 14;

interface CandidateRow {
  id: string;
  companyId: string;
  key: string;
  path: string;
  startLine: number;
  endLine: number;
  source: string;
  snippet: string;
  recallCount: number;
  totalScore: number;
  maxScore: number;
  firstRecalledAt: Date;
  lastRecalledAt: Date;
  queryHashes: string[];
  recallDays: string[];
  conceptTags: string[];
}

function scoreCandidate(c: CandidateRow): number {
  const distinctDays = Math.max(1, c.recallDays.length);
  const ageDays = Math.max(0, (Date.now() - c.lastRecalledAt.getTime()) / 86_400_000);
  const consolidationDays = Math.max(
    0,
    (c.lastRecalledAt.getTime() - c.firstRecalledAt.getTime()) / 86_400_000,
  );

  // Mirrors OpenClaw's weights
  const frequency = Math.min(1, c.recallCount / (distinctDays * 3));
  const relevance = Math.min(1, c.totalScore / Math.max(1, c.recallCount));
  const diversity = Math.min(1, c.queryHashes.length / Math.max(1, distinctDays * 2));
  const recency = Math.pow(0.5, ageDays / HALF_LIFE_DAYS);
  const consolidation = Math.min(1, consolidationDays / 14);
  const conceptual = Math.min(1, c.conceptTags.length / 8);

  return (
    0.24 * frequency +
    0.30 * relevance +
    0.15 * diversity +
    0.15 * recency +
    0.10 * consolidation +
    0.06 * conceptual
  );
}

function chunkText(content: string): { text: string; startLine: number; endLine: number }[] {
  // Same paragraph-based chunker as apps/api memory module, simplified.
  if (!content.trim()) return [];
  const lines = content.split('\n');
  const paragraphs: { text: string; startLine: number; endLine: number }[] = [];
  let buf: { text: string[]; startLine: number; endLine: number } | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNo = i + 1;
    if (line.trim() === '') {
      if (buf) {
        paragraphs.push({ text: buf.text.join('\n'), startLine: buf.startLine, endLine: buf.endLine });
        buf = null;
      }
    } else if (!buf) {
      buf = { text: [line], startLine: lineNo, endLine: lineNo };
    } else {
      buf.text.push(line);
      buf.endLine = lineNo;
    }
  }
  if (buf) paragraphs.push({ text: buf.text.join('\n'), startLine: buf.startLine, endLine: buf.endLine });

  const out: { text: string; startLine: number; endLine: number }[] = [];
  let acc: { text: string; startLine: number; endLine: number } | null = null;
  for (const p of paragraphs) {
    if (!acc) {
      acc = { ...p };
    } else if (acc.text.length + p.text.length + 2 <= 500) {
      acc.text += '\n\n' + p.text;
      acc.endLine = p.endLine;
    } else {
      out.push(acc);
      acc = { ...p };
    }
  }
  if (acc) out.push(acc);
  return out;
}

const sha256hex = (s: string) => createHash('sha256').update(s).digest('hex');

async function promoteToMemoryDoc(
  companyId: string,
  promotions: { title: string; body: string }[],
): Promise<void> {
  if (promotions.length === 0) return;

  const path = 'MEMORY.md';
  const existing = await prisma.memoryFile.findUnique({
    where: { companyId_path: { companyId, path } },
  });

  let content = existing?.content ?? '# Long-Term Memory\n';
  const date = new Date().toISOString().slice(0, 10);
  for (const p of promotions) {
    content =
      content.replace(/\s+$/, '') +
      `\n\n## ${p.title}\n_dreamed ${date}_\n\n${p.body.trim()}\n`;
  }

  const hash = sha256hex(content);

  // Upsert the file
  const file = await prisma.memoryFile.upsert({
    where: { companyId_path: { companyId, path } },
    create: {
      companyId,
      path,
      source: 'memory',
      content,
      hash,
      size: content.length,
    },
    update: {
      content,
      hash,
      size: content.length,
    },
  });

  // Re-chunk the rewritten file. Embeddings are left NULL — the textSearch
  // tsvector column is GENERATED ALWAYS, so FTS works immediately, and the
  // API's MemoryService will fill in embeddings on the next writeFile call.
  await prisma.memoryChunk.deleteMany({ where: { fileId: file.id } });
  const chunks = chunkText(content);
  for (const c of chunks) {
    await prisma.$executeRawUnsafe(
      `INSERT INTO "MemoryChunk"
         ("id", "companyId", "fileId", "path", "source",
          "startLine", "endLine", "hash", "text", "model",
          "embedding", "createdAt", "updatedAt")
       VALUES
         ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NULL, NOW(), NOW())`,
      randomUUID(),
      companyId,
      file.id,
      path,
      'memory',
      c.startLine,
      c.endLine,
      sha256hex(c.text),
      c.text,
      'none',
    );
  }
}

async function runDreaming(): Promise<{ promoted: number; scanned: number }> {
  const candidates = await prisma.recallEntry.findMany({
    where: {
      promotedAt: null,
      recallCount: { gte: MIN_RECALL_COUNT },
    },
    take: 500,
    orderBy: { lastRecalledAt: 'desc' },
  });

  const eligible = candidates.filter((c) => c.queryHashes.length >= MIN_DISTINCT_QUERIES);
  if (eligible.length === 0) return { promoted: 0, scanned: candidates.length };

  // Group by company so we only rewrite each MEMORY.md once per run.
  const byCompany = new Map<string, { row: CandidateRow; score: number }[]>();
  for (const row of eligible) {
    const score = scoreCandidate(row as unknown as CandidateRow);
    if (score < PROMOTION_SCORE_THRESHOLD) continue;
    const list = byCompany.get(row.companyId) ?? [];
    list.push({ row: row as unknown as CandidateRow, score });
    byCompany.set(row.companyId, list);
  }

  let promotedTotal = 0;
  for (const [companyId, list] of byCompany) {
    list.sort((a, b) => b.score - a.score);
    const top = list.slice(0, MAX_CANDIDATES_PER_RUN);
    const promotions = top.map(({ row }) => ({
      title: `${row.path}:${row.startLine}-${row.endLine}`,
      body: row.snippet,
    }));
    await promoteToMemoryDoc(companyId, promotions);

    await prisma.recallEntry.updateMany({
      where: { id: { in: top.map((t) => t.row.id) } },
      data: { promotedAt: new Date() },
    });
    promotedTotal += top.length;
  }

  return { promoted: promotedTotal, scanned: candidates.length };
}

export function startMemoryDreamingProcessor(): Worker {
  const worker = new Worker(
    QUEUES.MEMORY_DREAMING,
    async (_job: Job) => {
      const result = await runDreaming();
      logger.info(result, 'Memory dreaming complete');
      return result;
    },
    { connection, concurrency: 1 },
  );

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, err }, 'memory dreaming job failed');
  });

  logger.info('Memory dreaming processor started');
  return worker;
}

export function memoryDreamingQueue(): Queue {
  return new Queue(QUEUES.MEMORY_DREAMING, {
    connection: new Redis((process.env.REDIS_URL || '').trim(), { maxRetriesPerRequest: null }),
  });
}
