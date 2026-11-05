-- Countdown timer for a live activity: when set, the server stops the activity at this time.
ALTER TABLE "activity_runs" ADD COLUMN "ends_at" TIMESTAMPTZ(3);
