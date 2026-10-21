# Dev image shared by web and api. Build arg APP selects the workspace app.
FROM node:22-alpine

ARG APP
ENV APP=${APP}

RUN corepack enable
WORKDIR /repo

# Install deps first so this layer caches until a manifest changes.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile --filter "${APP}..." --filter moddeck

COPY tsconfig.base.json eslint.base.mjs .prettierrc.json ./
COPY apps/${APP} apps/${APP}

# The api needs the generated Prisma client (gitignored) before it starts or seeds.
RUN if [ "${APP}" = "api" ]; then pnpm --filter api db:generate; fi

WORKDIR /repo/apps/${APP}
CMD ["pnpm", "dev"]
