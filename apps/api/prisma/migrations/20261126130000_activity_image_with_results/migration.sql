-- On: the projector keeps the activity picture next to the answers after the start.
ALTER TABLE "activities" ADD COLUMN "image_with_results" BOOLEAN NOT NULL DEFAULT false;
