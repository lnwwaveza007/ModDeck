-- Co-host (F12): the controller of a session (empty: the owner), the invite that waits to be
-- accepted, and the audit log of invites, accepts and take-overs.

-- CreateEnum
CREATE TYPE "audit_action" AS ENUM ('cohost_invited', 'cohost_invite_cancelled', 'cohost_accepted', 'cohost_removed', 'takeover', 'takeback');

-- AlterTable
ALTER TABLE "sessions" ADD COLUMN     "controller_id" UUID;

-- CreateTable
CREATE TABLE "cohost_invites" (
    "id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "email" TEXT,
    "token_hash" TEXT NOT NULL,
    "invited_by" UUID NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cohost_invites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session_audit_logs" (
    "id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "actor_id" UUID,
    "action" "audit_action" NOT NULL,
    "details" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "session_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "cohost_invites_session_id_key" ON "cohost_invites"("session_id");

-- CreateIndex
CREATE UNIQUE INDEX "cohost_invites_token_hash_key" ON "cohost_invites"("token_hash");

-- CreateIndex
CREATE INDEX "cohost_invites_email_idx" ON "cohost_invites"("email");

-- CreateIndex
CREATE INDEX "cohost_invites_invited_by_idx" ON "cohost_invites"("invited_by");

-- CreateIndex
CREATE INDEX "session_audit_logs_session_id_created_at_idx" ON "session_audit_logs"("session_id", "created_at");

-- CreateIndex
CREATE INDEX "session_audit_logs_actor_id_idx" ON "session_audit_logs"("actor_id");

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_controller_id_fkey" FOREIGN KEY ("controller_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cohost_invites" ADD CONSTRAINT "cohost_invites_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cohost_invites" ADD CONSTRAINT "cohost_invites_invited_by_fkey" FOREIGN KEY ("invited_by") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_audit_logs" ADD CONSTRAINT "session_audit_logs_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_audit_logs" ADD CONSTRAINT "session_audit_logs_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
