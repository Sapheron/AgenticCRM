-- ─────────────────────────────────────────────────────────────────────────────
-- Pre-push migration: safely add columns that are non-nullable in the schema
-- but have no default — prisma db push cannot handle these when rows exist.
-- Run this BEFORE `prisma db push`. Safe to re-run (all statements are guarded).
-- ─────────────────────────────────────────────────────────────────────────────

-- Form.slug (String, non-nullable, no @default in schema)
-- Backfill existing rows with the record id so the slug is unique and valid.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'Form' AND column_name = 'slug'
  ) THEN
    ALTER TABLE "Form" ADD COLUMN "slug" TEXT;
    UPDATE "Form" SET "slug" = id WHERE "slug" IS NULL;
    ALTER TABLE "Form" ALTER COLUMN "slug" SET NOT NULL;
  END IF;
END $$;

-- Form.updatedAt (DateTime @updatedAt, non-nullable)
-- Backfill existing rows from createdAt so the column has a sensible value.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'Form' AND column_name = 'updatedAt'
  ) THEN
    ALTER TABLE "Form" ADD COLUMN "updatedAt" TIMESTAMPTZ;
    UPDATE "Form" SET "updatedAt" = "createdAt" WHERE "updatedAt" IS NULL;
    ALTER TABLE "Form" ALTER COLUMN "updatedAt" SET NOT NULL;
  END IF;
END $$;

-- ChatConversation.whatsappAccountId (String?, nullable — safe for prisma db push,
-- but included here so partial deploys also pick it up cleanly).
ALTER TABLE "ChatConversation" ADD COLUMN IF NOT EXISTS "whatsappAccountId" TEXT;
CREATE INDEX IF NOT EXISTS "ChatConversation_companyId_userId_whatsappAccountId_idx"
  ON "ChatConversation"("companyId", "userId", "whatsappAccountId");

-- ChatConversation.messageCount (Int, non-nullable, default 0) — used to dedupe
-- brand-new empty conversations when the user rapid-clicks "New Chat".
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ChatConversation' AND column_name = 'messageCount'
  ) THEN
    ALTER TABLE "ChatConversation" ADD COLUMN "messageCount" INTEGER NOT NULL DEFAULT 0;
    -- Backfill from the existing ChatMessage count per conversation
    UPDATE "ChatConversation" c
    SET "messageCount" = (
      SELECT COUNT(*) FROM "ChatMessage" m WHERE m."conversationId" = c.id
    );
  END IF;
END $$;

-- ContactNote.updatedAt (DateTime @updatedAt, non-nullable) + deletedAt (nullable).
-- Backfill updatedAt from createdAt for existing rows.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ContactNote' AND column_name = 'updatedAt'
  ) THEN
    ALTER TABLE "ContactNote" ADD COLUMN "updatedAt" TIMESTAMPTZ;
    UPDATE "ContactNote" SET "updatedAt" = "createdAt" WHERE "updatedAt" IS NULL;
    ALTER TABLE "ContactNote" ALTER COLUMN "updatedAt" SET NOT NULL;
  END IF;
END $$;
ALTER TABLE "ContactNote" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMPTZ;

-- LeadActivity.updatedAt + deletedAt (for note-type soft-delete + edit tracking).
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'LeadActivity' AND column_name = 'updatedAt'
  ) THEN
    ALTER TABLE "LeadActivity" ADD COLUMN "updatedAt" TIMESTAMPTZ;
    UPDATE "LeadActivity" SET "updatedAt" = "createdAt" WHERE "updatedAt" IS NULL;
    ALTER TABLE "LeadActivity" ALTER COLUMN "updatedAt" SET NOT NULL;
  END IF;
END $$;
ALTER TABLE "LeadActivity" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMPTZ;

-- DealActivity.updatedAt + deletedAt (same story as LeadActivity).
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'DealActivity' AND column_name = 'updatedAt'
  ) THEN
    ALTER TABLE "DealActivity" ADD COLUMN "updatedAt" TIMESTAMPTZ;
    UPDATE "DealActivity" SET "updatedAt" = "createdAt" WHERE "updatedAt" IS NULL;
    ALTER TABLE "DealActivity" ALTER COLUMN "updatedAt" SET NOT NULL;
  END IF;
END $$;
ALTER TABLE "DealActivity" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMPTZ;
