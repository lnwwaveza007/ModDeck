# ModDeck

Real-time interactive presentation platform for KMUTT classrooms.

Monorepo (pnpm workspaces):

| Path       | What                                    | Port |
| ---------- | --------------------------------------- | ---- |
| `apps/web` | Next.js frontend (TypeScript, Tailwind) | 3000 |
| `apps/api` | NestJS backend (`GET /health`)          | 4000 |
| —          | PostgreSQL 17 + pgvector                | 5432 |
| —          | Redis 7                                 | 6379 |

## Local setup

Requires Docker Desktop, Node.js 22+, and pnpm (`corepack enable`).

1. Clone the repo and `cd` into it.
2. `cp .env.example .env`
3. `docker compose up --build`
4. Open http://localhost:3000 (web) and http://localhost:4000/health (api).

Source in `apps/*/src` is mounted into the containers, so edits hot-reload.

### Run apps outside Docker

```sh
pnpm install
docker compose up -d postgres redis
pnpm dev
```

## Checks

These match CI (`.github/workflows/ci.yml`), which runs on every PR:

```sh
pnpm format:check
pnpm lint
pnpm test
pnpm --filter api test:e2e
```

Run `pnpm format` to fix formatting.
