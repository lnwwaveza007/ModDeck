-- CreateEnum
CREATE TYPE "slide_kind" AS ENUM ('text', 'code', 'math', 'image', 'poll', 'word_cloud');

-- CreateEnum
CREATE TYPE "activity_type" AS ENUM ('poll', 'word_cloud');

-- CreateEnum
CREATE TYPE "import_status" AS ENUM ('queued', 'running', 'done', 'failed');

-- CreateEnum
CREATE TYPE "session_status" AS ENUM ('live', 'host_away', 'ended');

-- CreateEnum
CREATE TYPE "session_end_reason" AS ENUM ('host', 'timeout');

-- CreateEnum
CREATE TYPE "login_type" AS ENUM ('sso', 'guest');

-- CreateEnum
CREATE TYPE "participant_status" AS ENUM ('active', 'removed');

-- CreateEnum
CREATE TYPE "activity_run_state" AS ENUM ('draft', 'live', 'closed', 'results_shown');

-- CreateEnum
CREATE TYPE "question_status" AS ENUM ('visible', 'highlighted', 'answered', 'hidden', 'deleted');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "sso_subject" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "student_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "decks" (
    "id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "require_kmutt_login" BOOLEAN NOT NULL DEFAULT false,
    "qa_enabled" BOOLEAN NOT NULL DEFAULT true,
    "anonymous_allowed" BOOLEAN NOT NULL DEFAULT true,
    "show_results_live" BOOLEAN NOT NULL DEFAULT false,
    "auto_start" BOOLEAN NOT NULL DEFAULT false,
    "reactions_enabled" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "decks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "slides" (
    "id" UUID NOT NULL,
    "deck_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "kind" "slide_kind" NOT NULL,
    "content" TEXT,
    "image_ref" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "slides_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activities" (
    "id" UUID NOT NULL,
    "slide_id" UUID NOT NULL,
    "type" "activity_type" NOT NULL,
    "prompt" TEXT NOT NULL,
    "multiple_choice" BOOLEAN NOT NULL DEFAULT false,
    "allow_answer_change" BOOLEAN NOT NULL DEFAULT false,
    "max_entries_per_person" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "activities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activity_options" (
    "id" UUID NOT NULL,
    "activity_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "label" TEXT NOT NULL,

    CONSTRAINT "activity_options_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pdf_imports" (
    "id" UUID NOT NULL,
    "deck_id" UUID NOT NULL,
    "file_name" TEXT NOT NULL,
    "page_count" INTEGER,
    "status" "import_status" NOT NULL DEFAULT 'queued',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "pdf_imports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL,
    "deck_id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "pin" CHAR(6) NOT NULL,
    "status" "session_status" NOT NULL DEFAULT 'live',
    "current_slide_id" UUID,
    "settings" JSONB NOT NULL,
    "started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMPTZ(3),
    "end_reason" "session_end_reason",

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session_cohosts" (
    "session_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "invited_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "session_cohosts_pkey" PRIMARY KEY ("session_id","user_id")
);

-- CreateTable
CREATE TABLE "participants" (
    "id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "user_id" UUID,
    "login_type" "login_type" NOT NULL,
    "nickname" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "token_expires_at" TIMESTAMPTZ(3) NOT NULL,
    "status" "participant_status" NOT NULL DEFAULT 'active',
    "joined_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "participants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activity_runs" (
    "id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "activity_id" UUID NOT NULL,
    "state" "activity_run_state" NOT NULL DEFAULT 'draft',
    "first_opened_at" TIMESTAMPTZ(3),
    "last_reopened_at" TIMESTAMPTZ(3),
    "closed_at" TIMESTAMPTZ(3),

    CONSTRAINT "activity_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "answers" (
    "activity_run_id" UUID NOT NULL,
    "participant_id" UUID NOT NULL,
    "option_id" UUID NOT NULL,
    "after_reopen" BOOLEAN NOT NULL DEFAULT false,
    "answered_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "answers_pkey" PRIMARY KEY ("activity_run_id","participant_id","option_id")
);

-- CreateTable
CREATE TABLE "word_entries" (
    "id" UUID NOT NULL,
    "activity_run_id" UUID NOT NULL,
    "participant_id" UUID NOT NULL,
    "text" TEXT NOT NULL,
    "normalized_text" TEXT NOT NULL,
    "hidden" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "word_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "questions" (
    "id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "participant_id" UUID NOT NULL,
    "text" TEXT NOT NULL,
    "anonymous" BOOLEAN NOT NULL DEFAULT true,
    "status" "question_status" NOT NULL DEFAULT 'visible',
    "duplicate_of_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "questions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "question_votes" (
    "question_id" UUID NOT NULL,
    "participant_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "question_votes_pkey" PRIMARY KEY ("question_id","participant_id")
);

-- CreateTable
CREATE TABLE "reaction_counts" (
    "session_id" UUID NOT NULL,
    "slide_id" UUID NOT NULL,
    "emoji" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "reaction_counts_pkey" PRIMARY KEY ("session_id","slide_id","emoji")
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
CREATE INDEX "pdf_imports_deck_id_created_at_idx" ON "pdf_imports"("deck_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "sessions_pin_idx" ON "sessions"("pin");

-- CreateIndex
CREATE INDEX "sessions_owner_id_started_at_idx" ON "sessions"("owner_id", "started_at" DESC);

-- CreateIndex
CREATE INDEX "sessions_deck_id_status_idx" ON "sessions"("deck_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_live_pin_key" ON "sessions"("pin") WHERE (status <> 'ended');

-- CreateIndex
CREATE UNIQUE INDEX "session_cohosts_session_id_key" ON "session_cohosts"("session_id");

-- CreateIndex
CREATE INDEX "session_cohosts_user_id_idx" ON "session_cohosts"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "participants_token_hash_key" ON "participants"("token_hash");

-- CreateIndex
CREATE INDEX "participants_user_id_idx" ON "participants"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "participants_session_id_nickname_key" ON "participants"("session_id", "nickname");

-- CreateIndex
CREATE UNIQUE INDEX "participants_session_id_user_id_key" ON "participants"("session_id", "user_id");

-- CreateIndex
CREATE INDEX "activity_runs_activity_id_idx" ON "activity_runs"("activity_id");

-- CreateIndex
CREATE UNIQUE INDEX "activity_runs_session_id_activity_id_key" ON "activity_runs"("session_id", "activity_id");

-- CreateIndex
CREATE INDEX "answers_activity_run_id_option_id_idx" ON "answers"("activity_run_id", "option_id");

-- CreateIndex
CREATE INDEX "answers_participant_id_idx" ON "answers"("participant_id");

-- CreateIndex
CREATE INDEX "answers_option_id_idx" ON "answers"("option_id");

-- CreateIndex
CREATE INDEX "word_entries_activity_run_id_normalized_text_idx" ON "word_entries"("activity_run_id", "normalized_text");

-- CreateIndex
CREATE INDEX "word_entries_participant_id_idx" ON "word_entries"("participant_id");

-- CreateIndex
CREATE INDEX "questions_session_id_created_at_idx" ON "questions"("session_id", "created_at");

-- CreateIndex
CREATE INDEX "questions_participant_id_idx" ON "questions"("participant_id");

-- CreateIndex
CREATE INDEX "questions_duplicate_of_id_idx" ON "questions"("duplicate_of_id");

-- CreateIndex
CREATE INDEX "question_votes_participant_id_idx" ON "question_votes"("participant_id");

-- CreateIndex
CREATE INDEX "reaction_counts_slide_id_idx" ON "reaction_counts"("slide_id");

-- AddForeignKey
ALTER TABLE "decks" ADD CONSTRAINT "decks_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "slides" ADD CONSTRAINT "slides_deck_id_fkey" FOREIGN KEY ("deck_id") REFERENCES "decks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activities" ADD CONSTRAINT "activities_slide_id_fkey" FOREIGN KEY ("slide_id") REFERENCES "slides"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_options" ADD CONSTRAINT "activity_options_activity_id_fkey" FOREIGN KEY ("activity_id") REFERENCES "activities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pdf_imports" ADD CONSTRAINT "pdf_imports_deck_id_fkey" FOREIGN KEY ("deck_id") REFERENCES "decks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_deck_id_fkey" FOREIGN KEY ("deck_id") REFERENCES "decks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_current_slide_id_fkey" FOREIGN KEY ("current_slide_id") REFERENCES "slides"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_cohosts" ADD CONSTRAINT "session_cohosts_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_cohosts" ADD CONSTRAINT "session_cohosts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "participants" ADD CONSTRAINT "participants_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "participants" ADD CONSTRAINT "participants_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_runs" ADD CONSTRAINT "activity_runs_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_runs" ADD CONSTRAINT "activity_runs_activity_id_fkey" FOREIGN KEY ("activity_id") REFERENCES "activities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "answers" ADD CONSTRAINT "answers_activity_run_id_fkey" FOREIGN KEY ("activity_run_id") REFERENCES "activity_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "answers" ADD CONSTRAINT "answers_participant_id_fkey" FOREIGN KEY ("participant_id") REFERENCES "participants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "answers" ADD CONSTRAINT "answers_option_id_fkey" FOREIGN KEY ("option_id") REFERENCES "activity_options"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "word_entries" ADD CONSTRAINT "word_entries_activity_run_id_fkey" FOREIGN KEY ("activity_run_id") REFERENCES "activity_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "word_entries" ADD CONSTRAINT "word_entries_participant_id_fkey" FOREIGN KEY ("participant_id") REFERENCES "participants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "questions" ADD CONSTRAINT "questions_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "questions" ADD CONSTRAINT "questions_participant_id_fkey" FOREIGN KEY ("participant_id") REFERENCES "participants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "questions" ADD CONSTRAINT "questions_duplicate_of_id_fkey" FOREIGN KEY ("duplicate_of_id") REFERENCES "questions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "question_votes" ADD CONSTRAINT "question_votes_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "questions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "question_votes" ADD CONSTRAINT "question_votes_participant_id_fkey" FOREIGN KEY ("participant_id") REFERENCES "participants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reaction_counts" ADD CONSTRAINT "reaction_counts_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reaction_counts" ADD CONSTRAINT "reaction_counts_slide_id_fkey" FOREIGN KEY ("slide_id") REFERENCES "slides"("id") ON DELETE CASCADE ON UPDATE CASCADE;
