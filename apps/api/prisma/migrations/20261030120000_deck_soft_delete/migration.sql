-- AlterTable
ALTER TABLE "decks" ADD COLUMN "deleted_at" TIMESTAMPTZ(3);

-- DropIndex
DROP INDEX "decks_owner_id_updated_at_idx";

-- CreateIndex
CREATE INDEX "decks_owner_id_updated_at_idx" ON "decks"("owner_id", "updated_at" DESC) WHERE (deleted_at IS NULL);
