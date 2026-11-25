-- Admin impersonation: an admin's host login can act as another user until the admin stops.

-- AlterTable
ALTER TABLE "host_sessions" ADD COLUMN     "impersonated_user_id" UUID;

-- AddForeignKey
ALTER TABLE "host_sessions" ADD CONSTRAINT "host_sessions_impersonated_user_id_fkey" FOREIGN KEY ("impersonated_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
