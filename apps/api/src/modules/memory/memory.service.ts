/**
 * Memory Service — OpenClaw-style file/chunk/recall storage backed by pgvector.
 *
 * Each "memory" is a markdown file (`MemoryFile`) split into ~500-char chunks
 * (`MemoryChunk`) that carry both a vector embedding (for semantic search) and
 * a tsvector (for keyword search). Reads merge both signals with temporal
 * decay, the same scoring strategy OpenClaw uses on top of SQLite vec0+FTS5.
 *
 * Recalls are tracked in `RecallEntry` so the worker's dreaming job can later
 * promote frequently-recalled chunks into the long-term `MEMORY.md` file.
 */
import { Injectable, NotFoundException } from '@nestjs/common';
import { prisma } from '@wacrm/database';
import { chunkMarkdown, sha256 } from './chunker';
import { getCompanyEmbedder, toPgVector, EMBEDDING_DIM } from './embeddings';

export interface SearchHit {
  id: string;
  path: string;
  source: string;
  startLine: number;
  endLine: number;
  text: string;
  score: number;
  vecScore: number;
  textScore: number;
}

export interface SearchOptions {
  maxResults?: number;
  minScore?: number;
  source?: string;
}

@Injectable()
export class MemoryService {
  // ── File CRUD ────────────────────────────────────────────────────────────

  async listFiles(companyId: string, source?: string) {
    return prisma.memoryFile.findMany({
      where: { companyId, ...(source ? { source } : {}) },
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        path: true,
        source: true,
        size: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  async getFile(companyId: string, path: string) {
    const file = await prisma.memoryFile.findUnique({
      where: { companyId_path: { companyId, path } },
    });
    if (!file) throw new NotFoundException(`Memory file not found: ${path}`);
    return file;
  }

  async readFile(
    companyId: string,
    path: string,
    fromLine?: number,
    lineCount?: number,
  ): Promise<string | null> {
    const file = await prisma.memoryFile.findUnique({
      where: { companyId_path: { companyId, path } },
      select: { content: true },
    });
    if (!file) return null;
    if (fromLine === undefined) return file.content;
    const lines = file.content.split('\n');
    const start = Math.max(1, fromLine) - 1;
    const end = lineCount ? start + lineCount : lines.length;
    return lines.slice(start, end).join('\n');
  }

  /**
   * Write (create or replace) a memory file. Re-chunks the content, embeds
   * each chunk via the company's configured embedding provider, and stores
   * everything in `MemoryChunk` with vector + tsvector for hybrid search.
   */
  async writeFile(
    companyId: string,
    path: string,
    content: string,
    source = 'memory',
  ): Promise<{ fileId: string; chunkCount: number }> {
    const hash = await sha256(content);

    const file = await prisma.memoryFile.upsert({
      where: { companyId_path: { companyId, path } },
      create: {
        companyId,
        path,
        source,
        content,
        hash,
        size: content.length,
      },
      update: {
        content,
        hash,
        source,
        size: content.length,
      },
    });

    // Wipe and re-build chunks. Re-embedding everything is fine for the
    // file sizes we expect (a few KB); we can swap to delta indexing later.
    await prisma.memoryChunk.deleteMany({ where: { fileId: file.id } });

    const chunks = chunkMarkdown(content);
    if (chunks.length === 0) return { fileId: file.id, chunkCount: 0 };

    const embedder = await getCompanyEmbedder(companyId).catch(() => null);
    const modelName = embedder ? 'embedded' : 'none';

    for (const c of chunks) {
      const chunkHash = await sha256(c.text);
      let embeddingLiteral: string | null = null;
      let model = 'none';
      if (embedder) {
        try {
          const result = await embedder(c.text);
          embeddingLiteral = toPgVector(result.vector);
          model = result.model;
        } catch (err) {
          // Embedding failed — fall back to keyword-only for this chunk.
          console.warn('[Memory] embed failed:', err instanceof Error ? err.message : err);
        }
      }

      // Prisma client can't write to the Unsupported vector column, so insert raw.
      await prisma.$executeRawUnsafe(
        `INSERT INTO "MemoryChunk"
           ("id", "companyId", "fileId", "path", "source",
            "startLine", "endLine", "hash", "text", "model",
            "embedding", "createdAt", "updatedAt")
         VALUES
           (gen_random_uuid()::text, $1, $2, $3, $4,
            $5, $6, $7, $8, $9,
            ${embeddingLiteral ? `$10::vector` : 'NULL'}, NOW(), NOW())`,
        companyId,
        file.id,
        path,
        source,
        c.startLine,
        c.endLine,
        chunkHash,
        c.text,
        model,
        ...(embeddingLiteral ? [embeddingLiteral] : []),
      );
    }

    void modelName; // referenced for future telemetry
    return { fileId: file.id, chunkCount: chunks.length };
  }

  async deleteFile(companyId: string, path: string): Promise<void> {
    const file = await prisma.memoryFile.findUnique({
      where: { companyId_path: { companyId, path } },
    });
    if (!file) return;
    await prisma.memoryFile.delete({ where: { id: file.id } });
  }

  // ── Search (hybrid: vector + FTS + temporal decay) ───────────────────────

  async search(
    companyId: string,
    query: string,
    opts: SearchOptions = {},
  ): Promise<SearchHit[]> {
    const maxResults = Math.max(1, Math.min(opts.maxResults ?? 10, 50));
    const minScore = opts.minScore ?? 0;

    // Try vector search first if we have an embedder.
    const embedder = await getCompanyEmbedder(companyId).catch(() => null);
    let vectorRows: Array<{ id: string; vec_score: number }> = [];
    if (embedder) {
      try {
        const { vector } = await embedder(query);
        const literal = toPgVector(vector);
        vectorRows = await prisma.$queryRawUnsafe<Array<{ id: string; vec_score: number }>>(
          `SELECT "id", 1 - ("embedding" <=> $1::vector) AS vec_score
             FROM "MemoryChunk"
            WHERE "companyId" = $2
              AND "embedding" IS NOT NULL
              ${opts.source ? `AND "source" = $3` : ''}
            ORDER BY "embedding" <=> $1::vector
            LIMIT 20`,
          literal,
          companyId,
          ...(opts.source ? [opts.source] : []),
        );
      } catch (err) {
        console.warn('[Memory] vector search failed:', err instanceof Error ? err.message : err);
      }
    }

    // Always run keyword search alongside (BM25-style ranking via ts_rank).
    let textRows: Array<{ id: string; text_score: number }> = [];
    try {
      textRows = await prisma.$queryRawUnsafe<Array<{ id: string; text_score: number }>>(
        `SELECT "id", ts_rank("textSearch", websearch_to_tsquery('english', $1)) AS text_score
           FROM "MemoryChunk"
          WHERE "companyId" = $2
            AND "textSearch" @@ websearch_to_tsquery('english', $1)
            ${opts.source ? `AND "source" = $3` : ''}
          ORDER BY text_score DESC
          LIMIT 20`,
        query,
        companyId,
        ...(opts.source ? [opts.source] : []),
      );
    } catch (err) {
      console.warn('[Memory] FTS failed:', err instanceof Error ? err.message : err);
    }

    // Merge results by id.
    const merged = new Map<string, { vec: number; text: number }>();
    for (const r of vectorRows) {
      merged.set(r.id, { vec: Number(r.vec_score) || 0, text: 0 });
    }
    for (const r of textRows) {
      const prev = merged.get(r.id) ?? { vec: 0, text: 0 };
      prev.text = Number(r.text_score) || 0;
      merged.set(r.id, prev);
    }

    if (merged.size === 0) return [];

    // Hydrate full chunk metadata.
    const ids = [...merged.keys()];
    const chunks = await prisma.memoryChunk.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        path: true,
        source: true,
        startLine: true,
        endLine: true,
        text: true,
        updatedAt: true,
      },
    });

    const now = Date.now();
    const hits: SearchHit[] = chunks.map((c) => {
      const scores = merged.get(c.id) ?? { vec: 0, text: 0 };
      const ageDays = Math.max(0, (now - c.updatedAt.getTime()) / 86_400_000);
      // Hybrid score: 50/50 vec+text, decayed by half-life of 14 days.
      const base = 0.5 * scores.vec + 0.5 * scores.text;
      const decay = Math.pow(0.5, ageDays / 14);
      return {
        id: c.id,
        path: c.path,
        source: c.source,
        startLine: c.startLine,
        endLine: c.endLine,
        text: c.text,
        vecScore: scores.vec,
        textScore: scores.text,
        score: base * decay,
      };
    });

    hits.sort((a, b) => b.score - a.score);
    const filtered = hits.filter((h) => h.score >= minScore).slice(0, maxResults);

    // Fire-and-forget: track recalls for the dreaming job.
    void this.recordRecalls(companyId, query, filtered).catch((err) =>
      console.warn('[Memory] recordRecalls failed:', err),
    );

    return filtered;
  }

  // ── Recall tracking (feeds the dreaming job) ─────────────────────────────

  async recordRecalls(companyId: string, query: string, hits: SearchHit[]): Promise<void> {
    if (hits.length === 0) return;
    const queryHash = await sha256(query.toLowerCase().trim());
    const today = new Date().toISOString().slice(0, 10);

    for (const hit of hits) {
      const key = `${hit.source}:${hit.path}:${hit.startLine}:${hit.endLine}`;
      const existing = await prisma.recallEntry.findUnique({
        where: { companyId_key: { companyId, key } },
      });

      if (existing) {
        const queryHashes = existing.queryHashes.includes(queryHash)
          ? existing.queryHashes
          : [queryHash, ...existing.queryHashes].slice(0, 32);
        const recallDays = existing.recallDays.includes(today)
          ? existing.recallDays
          : [today, ...existing.recallDays].slice(0, 16);

        await prisma.recallEntry.update({
          where: { id: existing.id },
          data: {
            recallCount: existing.recallCount + 1,
            totalScore: existing.totalScore + hit.score,
            maxScore: Math.max(existing.maxScore, hit.score),
            lastRecalledAt: new Date(),
            queryHashes,
            recallDays,
          },
        });
      } else {
        await prisma.recallEntry.create({
          data: {
            companyId,
            key,
            path: hit.path,
            startLine: hit.startLine,
            endLine: hit.endLine,
            source: hit.source,
            snippet: hit.text.slice(0, 500),
            recallCount: 1,
            totalScore: hit.score,
            maxScore: hit.score,
            queryHashes: [queryHash],
            recallDays: [today],
            conceptTags: [],
          },
        });
      }
    }
  }

  // ── MEMORY.md helpers ────────────────────────────────────────────────────

  /** Append a titled section to MEMORY.md (creates the file if missing). */
  async appendToMemoryDoc(companyId: string, title: string, body: string): Promise<void> {
    const path = 'MEMORY.md';
    const existing = (await this.readFile(companyId, path)) ?? '# Long-Term Memory\n';
    const stamp = new Date().toISOString().slice(0, 10);
    const next = `${existing.replace(/\s+$/, '')}\n\n## ${title}\n_${stamp}_\n\n${body.trim()}\n`;
    await this.writeFile(companyId, path, next, 'memory');
  }

  /** Build the system-prompt memory section. Always reads MEMORY.md verbatim. */
  async getSystemPromptMemory(companyId: string): Promise<string> {
    const memoryDoc = await this.readFile(companyId, 'MEMORY.md');
    if (!memoryDoc?.trim()) return '';
    return [
      '## Long-Term Memory (MEMORY.md)',
      '',
      memoryDoc.trim(),
      '',
      '## Memory Recall',
      'Before answering anything about prior work, decisions, dates, people, preferences, or todos, call `memory_search` first. Use `memory_get` to read specific files in full.',
    ].join('\n');
  }

  // ── Stats (used by the dashboard memory page) ────────────────────────────

  async stats(companyId: string) {
    const [files, chunks, recalls, embedded] = await Promise.all([
      prisma.memoryFile.count({ where: { companyId } }),
      prisma.memoryChunk.count({ where: { companyId } }),
      prisma.recallEntry.count({ where: { companyId } }),
      prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
        `SELECT COUNT(*)::bigint AS count FROM "MemoryChunk" WHERE "companyId" = $1 AND "embedding" IS NOT NULL`,
        companyId,
      ),
    ]);
    return {
      files,
      chunks,
      recalls,
      embeddedChunks: Number(embedded[0]?.count ?? 0),
      embeddingDim: EMBEDDING_DIM,
    };
  }
}
