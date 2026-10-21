-- CreateEnum
CREATE TYPE "SlideKind" AS ENUM ('text', 'code', 'math', 'image', 'activity');

-- CreateEnum
CREATE TYPE "ActivityType" AS ENUM ('live_poll', 'word_cloud');

-- CreateEnum
CREATE TYPE "SessionStatus" AS ENUM ('live', 'host_away', 'ended');

-- CreateEnum
CREATE TYPE "LoginType" AS ENUM ('sso', 'guest');

-- CreateEnum
CREATE TYPE "QuestionStatus" AS ENUM ('visible', 'highlighted', 'answered', 'hidden', 'merged', 'deleted');

-- CreateEnum
CREATE TYPE "ActivityRunState" AS ENUM ('draft', 'live', 'closed', 'results_shown');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "sso_subject" TEXT NOT NULL,
    "email" TEXT,
    "display_name" TEXT NOT NULL,
    "student_id" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "decks" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "owner_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "settings" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "decks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "slides" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "deck_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "kind" "SlideKind" NOT NULL,
    "content" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "slides_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activities" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "slide_id" UUID NOT NULL,
    "type" "ActivityType" NOT NULL,
    "prompt" TEXT NOT NULL,
    "config" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "activities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activity_options" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "activity_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "label" TEXT NOT NULL,

    CONSTRAINT "activity_options_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "deck_id" UUID NOT NULL,
    "host_id" UUID NOT NULL,
    "co_host_id" UUID,
    "pin" CHAR(6) NOT NULL,
    "status" "SessionStatus" NOT NULL DEFAULT 'live',
    "settings" JSONB NOT NULL DEFAULT '{}',
    "started_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMPTZ(6),
    "pin_released_at" TIMESTAMPTZ(6),

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "participants" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "session_id" UUID NOT NULL,
    "user_id" UUID,
    "login_type" "LoginType" NOT NULL,
    "nickname" TEXT NOT NULL,
    "team" TEXT,
    "token_hash" CHAR(64) NOT NULL,
    "token_expires_at" TIMESTAMPTZ(6) NOT NULL,
    "joined_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removed_at" TIMESTAMPTZ(6),

    CONSTRAINT "participants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "answers" (
    "id" BIGSERIAL NOT NULL,
    "session_id" UUID NOT NULL,
    "activity_id" UUID NOT NULL,
    "participant_id" UUID NOT NULL,
    "option_id" UUID,
    "text" TEXT,
    "slot" SMALLINT NOT NULL DEFAULT 0,
    "after_reopen" BOOLEAN NOT NULL DEFAULT false,
    "points" INTEGER NOT NULL DEFAULT 0,
    "answered_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "answers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "questions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "session_id" UUID NOT NULL,
    "participant_id" UUID,
    "body" TEXT NOT NULL,
    "is_anonymous" BOOLEAN NOT NULL DEFAULT true,
    "status" "QuestionStatus" NOT NULL DEFAULT 'visible',
    "merged_into_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "answered_at" TIMESTAMPTZ(6),

    CONSTRAINT "questions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "question_votes" (
    "question_id" UUID NOT NULL,
    "participant_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "question_votes_pkey" PRIMARY KEY ("question_id","participant_id")
);

-- CreateTable
CREATE TABLE "session_results" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "session_id" UUID NOT NULL,
    "activity_id" UUID NOT NULL,
    "final_state" "ActivityRunState" NOT NULL,
    "response_count" INTEGER NOT NULL DEFAULT 0,
    "summary" JSONB NOT NULL DEFAULT '{}',
    "was_reopened" BOOLEAN NOT NULL DEFAULT false,
    "closed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "session_results_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_sso_subject_key" ON "users"("sso_subject");

-- CreateIndex
CREATE INDEX "decks_owner_id_updated_at_idx" ON "decks"("owner_id", "updated_at" DESC);

-- CreateIndex
CREATE INDEX "slides_deck_id_position_idx" ON "slides"("deck_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "activities_slide_id_key" ON "activities"("slide_id");

-- CreateIndex
CREATE INDEX "activity_options_activity_id_position_idx" ON "activity_options"("activity_id", "position");

-- CreateIndex
CREATE INDEX "sessions_host_id_started_at_idx" ON "sessions"("host_id", "started_at" DESC);

-- CreateIndex
CREATE INDEX "sessions_deck_id_idx" ON "sessions"("deck_id");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_pin_active_key" ON "sessions"("pin") WHERE (pin_released_at IS NULL);

-- CreateIndex
CREATE UNIQUE INDEX "participants_token_hash_key" ON "participants"("token_hash");

-- CreateIndex
CREATE INDEX "participants_token_expires_at_idx" ON "participants"("token_expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "participants_session_id_nickname_key" ON "participants"("session_id", "nickname");

-- CreateIndex
CREATE UNIQUE INDEX "participants_session_id_user_id_key" ON "participants"("session_id", "user_id");

-- CreateIndex
CREATE INDEX "answers_session_id_activity_id_idx" ON "answers"("session_id", "activity_id");

-- CreateIndex
CREATE INDEX "answers_participant_id_idx" ON "answers"("participant_id");

-- CreateIndex
CREATE UNIQUE INDEX "answers_session_id_activity_id_participant_id_slot_key" ON "answers"("session_id", "activity_id", "participant_id", "slot");

-- CreateIndex
CREATE INDEX "questions_session_id_created_at_idx" ON "questions"("session_id", "created_at");

-- CreateIndex
CREATE INDEX "questions_merged_into_id_idx" ON "questions"("merged_into_id");

-- CreateIndex
CREATE UNIQUE INDEX "questions_one_highlighted_key" ON "questions"("session_id") WHERE (status = 'highlighted');

-- CreateIndex
CREATE INDEX "question_votes_participant_id_idx" ON "question_votes"("participant_id");

-- CreateIndex
CREATE INDEX "session_results_activity_id_idx" ON "session_results"("activity_id");

-- CreateIndex
CREATE UNIQUE INDEX "session_results_session_id_activity_id_key" ON "session_results"("session_id", "activity_id");

-- AddForeignKey
ALTER TABLE "decks" ADD CONSTRAINT "decks_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "slides" ADD CONSTRAINT "slides_deck_id_fkey" FOREIGN KEY ("deck_id") REFERENCES "decks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activities" ADD CONSTRAINT "activities_slide_id_fkey" FOREIGN KEY ("slide_id") REFERENCES "slides"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_options" ADD CONSTRAINT "activity_options_activity_id_fkey" FOREIGN KEY ("activity_id") REFERENCES "activities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_deck_id_fkey" FOREIGN KEY ("deck_id") REFERENCES "decks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_host_id_fkey" FOREIGN KEY ("host_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_co_host_id_fkey" FOREIGN KEY ("co_host_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "participants" ADD CONSTRAINT "participants_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "participants" ADD CONSTRAINT "participants_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "answers" ADD CONSTRAINT "answers_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "answers" ADD CONSTRAINT "answers_activity_id_fkey" FOREIGN KEY ("activity_id") REFERENCES "activities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "answers" ADD CONSTRAINT "answers_participant_id_fkey" FOREIGN KEY ("participant_id") REFERENCES "participants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "answers" ADD CONSTRAINT "answers_option_id_fkey" FOREIGN KEY ("option_id") REFERENCES "activity_options"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "questions" ADD CONSTRAINT "questions_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "questions" ADD CONSTRAINT "questions_participant_id_fkey" FOREIGN KEY ("participant_id") REFERENCES "participants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "questions" ADD CONSTRAINT "questions_merged_into_id_fkey" FOREIGN KEY ("merged_into_id") REFERENCES "questions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "question_votes" ADD CONSTRAINT "question_votes_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "questions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "question_votes" ADD CONSTRAINT "question_votes_participant_id_fkey" FOREIGN KEY ("participant_id") REFERENCES "participants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_results" ADD CONSTRAINT "session_results_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_results" ADD CONSTRAINT "session_results_activity_id_fkey" FOREIGN KEY ("activity_id") REFERENCES "activities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Checks Prisma cannot express in schema.prisma. Prisma ignores CHECK constraints, so they cause no drift.
-- Written one-directional on purpose: ON DELETE SET NULL on the referenced row must not violate them.
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_pin_format_chk" CHECK ("pin" ~ '^[0-9]{6}$');
ALTER TABLE "participants" ADD CONSTRAINT "participants_guest_no_user_chk"
  CHECK ("login_type" = 'sso' OR "user_id" IS NULL);
ALTER TABLE "answers" ADD CONSTRAINT "answers_not_option_and_text_chk"
  CHECK (NOT ("option_id" IS NOT NULL AND "text" IS NOT NULL));
ALTER TABLE "questions" ADD CONSTRAINT "questions_merged_target_chk"
  CHECK ("status" = 'merged' OR "merged_into_id" IS NULL);
