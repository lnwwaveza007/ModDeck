ALTER TABLE "sessions" ALTER COLUMN "status" DROP DEFAULT;

CREATE TYPE "session_status_new" AS ENUM ('live', 'host_away', 'ended');

ALTER TABLE "sessions"
  ALTER COLUMN "status" TYPE "session_status_new"
  USING (CASE WHEN "status"::text = 'lobby' THEN 'live' ELSE "status"::text END)::"session_status_new";

DROP TYPE "session_status";
ALTER TYPE "session_status_new" RENAME TO "session_status";

ALTER TABLE "sessions" ALTER COLUMN "status" SET DEFAULT 'live';
