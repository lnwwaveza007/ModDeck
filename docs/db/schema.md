# Database schema notes (R1-1)

ERD: [erd.md](erd.md). Schema file: [`apps/api/prisma/schema.prisma`](../../apps/api/prisma/schema.prisma).

## ORM decision: Prisma

We use **Prisma** (7.x) with the `pg` driver adapter, not TypeORM.

| Reason                  | Detail                                                                                                                                                                  |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| One schema file         | `schema.prisma` is the single readable model. The ERD in this folder is derived from it. TypeORM spreads the model over decorators in many entity classes.             |
| Reviewable migrations   | `prisma migrate dev` writes plain SQL files that we commit. `prisma migrate deploy` applies them with no prompts, which is what docker-compose and CI need.            |
| Typed client            | The generated client types every query from the schema, so a column rename breaks the build instead of production.                                                    |
| Raw SQL stays available | The MD-9 flusher needs `INSERT ... ON CONFLICT DO NOTHING` with `unnest`. Prisma has `$executeRaw` for that. The migration file also takes hand-written SQL (CHECKs). |
| Cost                    | pgvector columns (R2 Q&A clustering) are not a native Prisma type. When R2 starts, add the column in a hand-written migration and read it with raw SQL.               |

`partialIndexes` is a Prisma preview feature. We use it for two partial unique indexes (below). If it is removed, the same indexes can move into the migration SQL.

## How it connects to Redis (MD-9)

Live state is in Redis (`ans:{sid}:<qid>`, `votes:{sid}:<qid>`, `lb:{sid}`, `flush:{sid}`). PostgreSQL is the durable copy.

- `answers` has the same guard as the MD-9 spike: a unique key on `(session_id, activity_id, participant_id, slot)`. The flusher inserts with `ON CONFLICT DO NOTHING`, so a repeated flush adds no row.
- Vote counts and scores are **not** stored as counters. They come from `count(*)` and `sum(points)` over `answers`, so nothing in PostgreSQL can drift from Redis.
- `session_results` is the final snapshot per activity per session. It is written when an activity closes or the session ends, so the history screen and CSV export do not need Redis.
- After a Redis data loss the API should rebuild the hash and leaderboard for a live session from `answers` before it accepts new answers (MD-9 finding 6).

## How it connects to reconnect (MD-13)

The spike keeps a token record per participant: random token, `userId`, `sessionId`, `loginType`, sliding `expiresAt` (8 h, extended when less than half is left). In PostgreSQL this is on `participants`:

| Spike field      | Column                                                                                          |
| ---------------- | ----------------------------------------------------------------------------------------------- |
| `token`          | `token_hash`: SHA-256 hex of the cookie value. The raw token is never stored, so a DB leak is not a session leak. |
| `expiresAt`      | `token_expires_at`. A missing or past value fails closed. The API pushes it forward on use.     |
| `userId`         | `id` (participant) and `user_id` (SSO account, NULL for guests)                                 |
| `loginType`      | `login_type`                                                                                    |
| `pinToSession`   | `sessions_pin_active_key` partial unique index                                                  |

Expired tokens are cleaned by `participants (token_expires_at)`. Participants and their answers stay. Only the token stops working. A removed participant has `removed_at` set and cannot resume.

## Rules the database enforces

| Rule (source)                                                                 | Constraint                                                                 |
| ----------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| PIN is unique among live sessions, kept 24 h after end, then released (md-5 §2.1) | partial unique index on `pin` where `pin_released_at IS NULL`          |
| PIN is exactly 6 digits                                                       | `sessions_pin_format_chk`                                                  |
| Guest names are unique per session (md-5 §2.6)                                | unique `(session_id, nickname)`                                            |
| One participant row per SSO user per session                                  | unique `(session_id, user_id)`; NULL guests never collide                  |
| Guests have no user account                                                   | `participants_guest_no_user_chk`                                           |
| One answer per participant, activity and slot                                 | unique `(session_id, activity_id, participant_id, slot)`                   |
| An answer is a poll option or a word, not both                                | `answers_not_option_and_text_chk`                                          |
| One upvote per participant per question                                       | primary key `(question_id, participant_id)`                                |
| Only one question highlighted at a time (md-5 §7.2)                           | partial unique index on `session_id` where `status = 'highlighted'`        |
| Only a merged question has a merge target                                     | `questions_merged_target_chk`                                              |

CHECK constraints are appended by hand to the first migration. Prisma ignores them, so they cause no migration drift. They are written one-way on purpose, so `ON DELETE SET NULL` never violates them.

## Choices worth knowing

- **Ids are UUIDs** generated by `gen_random_uuid()` in the database, except `answers.id` (bigint identity) because it is the highest-volume table.
- **`slides.position` is not unique.** Reordering rewrites many rows in one statement and a unique key would fail mid-update. The API must renumber in one transaction.
- **Activity run state (draft, live, closed, results shown) lives in Redis during a session.** There is no per-session activity table in R1. The final state is stored in `session_results.final_state`. If the host-away recovery (md-5 §7.3) needs the state in PostgreSQL, add a table then.
- **Deck delete and host delete are blocked while sessions exist** (`ON DELETE RESTRICT` on `sessions.deck_id` and `host_id`), so results stay readable. The API also blocks deck delete while a session is live (md-5 §2.2).
- **Anonymous questions** keep `participant_id` for bans and upvote rules. `is_anonymous` decides what the API returns and what the export writes (md-5 §2.4).
- **`participants.team`** is nullable and unused in R1. It is there for the R2 team mode so that migration is not needed for it.
- **No `questions.embedding`.** AI clustering is R2 (MD-10).

## Run it

```bash
docker compose up -d postgres        # or: docker compose up   (the migrate service runs first)
pnpm --filter api db:generate        # generate the Prisma client into apps/api/src/generated
pnpm --filter api db:migrate         # apply committed migrations (prisma migrate deploy)
pnpm --filter api db:seed            # demo host + deck + poll; safe to repeat
```

Change the schema:

```bash
pnpm --filter api db:migrate:dev --name <short_name>   # writes a new migration, applies it to your dev DB
```

Review the generated SQL before you commit it. Never edit a migration that is already merged: add a new one.

`docker compose up` starts a one-shot `migrate` service (migrate, then seed). The `api` service waits for it. CI starts a pgvector Postgres service, runs `db:migrate` and `db:seed`, then the API e2e tests, which include `test/schema.e2e-spec.ts` (seed present, constraints hold).
