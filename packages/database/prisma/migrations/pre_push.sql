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
