-- Nicknames are unique among guests only: SSO participants show their real
-- name, and two students may share one.
DROP INDEX "participants_session_id_nickname_key";
CREATE UNIQUE INDEX "participants_session_id_nickname_key" ON "participants"("session_id", "nickname") WHERE (login_type = 'guest');
