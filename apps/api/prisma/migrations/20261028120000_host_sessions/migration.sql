-- CreateTable
CREATE TABLE "host_sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "host_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "host_sessions_token_hash_key" ON "host_sessions"("token_hash");

-- CreateIndex
CREATE INDEX "host_sessions_user_id_idx" ON "host_sessions"("user_id");

-- CreateIndex
CREATE INDEX "host_sessions_expires_at_idx" ON "host_sessions"("expires_at");

-- AddForeignKey
ALTER TABLE "host_sessions" ADD CONSTRAINT "host_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
