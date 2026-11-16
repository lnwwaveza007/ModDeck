-- Live reactions are on by default (R1-15). No screen has set this column yet, so every existing
-- deck still holds the old default: turn it on for them too.
ALTER TABLE "decks" ALTER COLUMN "reactions_enabled" SET DEFAULT true;
UPDATE "decks" SET "reactions_enabled" = true;
