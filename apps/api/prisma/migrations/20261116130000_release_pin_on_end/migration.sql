-- A PIN is held only while its session is open (fix: pins single-use per session). Ending a
-- session clears the PIN so the number can be issued again; the session's records stay under its id.

-- Finish sessions left half-ended by the old undo window: marked ended, but with no end time and
-- possibly an activity still live. Their PIN is cleared below like any other ended session.
UPDATE "activity_runs" SET "state" = 'closed', "ends_at" = NULL, "closed_at" = now()
WHERE "state" = 'live'
  AND "session_id" IN (SELECT "id" FROM "sessions" WHERE "status" = 'ended' AND "ended_at" IS NULL);
UPDATE "sessions" SET "ended_at" = now(), "end_reason" = 'host'
WHERE "status" = 'ended' AND "ended_at" IS NULL;

-- Release the PIN of every ended session.
ALTER TABLE "sessions" ALTER COLUMN "pin" DROP NOT NULL;
UPDATE "sessions" SET "pin" = NULL WHERE "status" = 'ended';

-- Only open sessions hold a PIN now, so a plain unique index replaces the partial one, and it also
-- serves the lookup the separate index was for. NULLs never collide.
DROP INDEX "sessions_live_pin_key";
DROP INDEX "sessions_pin_idx";
CREATE UNIQUE INDEX "sessions_pin_key" ON "sessions"("pin");
