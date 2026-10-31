-- AlterEnum
-- The new value cannot be used in the same transaction, so the next migration converts the rows.
ALTER TYPE "slide_kind" ADD VALUE 'content';
