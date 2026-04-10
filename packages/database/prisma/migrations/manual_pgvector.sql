-- ─────────────────────────────────────────────────────────────────────────────
-- OpenClaw-style memory: pgvector extension + vector/tsvector columns + indexes.
-- This is run by the install script *after* `prisma db push`, because Prisma's
-- `Unsupported("vector(1536)")` cannot create the column on its own.
-- Re-running this is safe (everything is IF NOT EXISTS).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS vector;

-- Vector embedding column (1536 dims = OpenAI text-embedding-3-small / Gemini text-embedding-004)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'MemoryChunk' AND column_name = 'embedding'
  ) THEN
    ALTER TABLE "MemoryChunk" ADD COLUMN embedding vector(1536);
  END IF;
END$$;

-- Generated tsvector column for full-text search
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'MemoryChunk' AND column_name = 'textSearch'
  ) THEN
    ALTER TABLE "MemoryChunk"
      ADD COLUMN "textSearch" tsvector
      GENERATED ALWAYS AS (to_tsvector('english', text)) STORED;
  END IF;
END$$;

-- IVFFlat index for cosine similarity search on the vector column
CREATE INDEX IF NOT EXISTS memory_chunk_embedding_idx
  ON "MemoryChunk" USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- GIN index for the FTS column
CREATE INDEX IF NOT EXISTS memory_chunk_text_search_idx
  ON "MemoryChunk" USING gin ("textSearch");
