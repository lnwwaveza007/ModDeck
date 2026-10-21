-- CreateEnum
CREATE TYPE "ImportStatus" AS ENUM ('queued', 'running', 'done', 'failed');

-- AlterTable
ALTER TABLE "answers" ADD COLUMN     "hidden" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "normalized_text" TEXT;

-- CreateTable
CREATE TABLE "reaction_counts" (
    "session_id" UUID NOT NULL,
    "slide_id" UUID NOT NULL,
    "emoji" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "reaction_counts_pkey" PRIMARY KEY ("session_id","slide_id","emoji")
);

-- CreateTable
CREATE TABLE "pdf_imports" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "deck_id" UUID NOT NULL,
    "file_name" TEXT NOT NULL,
    "page_count" INTEGER,
    "status" "ImportStatus" NOT NULL DEFAULT 'queued',
    "pages" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "pdf_imports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "reaction_counts_slide_id_idx" ON "reaction_counts"("slide_id");

-- CreateIndex
CREATE INDEX "pdf_imports_deck_id_created_at_idx" ON "pdf_imports"("deck_id", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "reaction_counts" ADD CONSTRAINT "reaction_counts_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reaction_counts" ADD CONSTRAINT "reaction_counts_slide_id_fkey" FOREIGN KEY ("slide_id") REFERENCES "slides"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pdf_imports" ADD CONSTRAINT "pdf_imports_deck_id_fkey" FOREIGN KEY ("deck_id") REFERENCES "decks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
