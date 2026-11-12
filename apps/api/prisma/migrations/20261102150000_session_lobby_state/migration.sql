ALTER TYPE "session_status" ADD VALUE 'lobby' BEFORE 'live';
ALTER TABLE "sessions" ALTER COLUMN "status" SET DEFAULT 'lobby';
