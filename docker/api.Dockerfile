# Production image for apps/api. Build from the repo root:
#   docker build -f docker/api.Dockerfile -t moddeck-api .
FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/

# Build stage: all deps, generate the Prisma client, compile to dist/.
FROM base AS build
RUN pnpm install --frozen-lockfile --filter api...
COPY tsconfig.base.json ./
COPY apps/api apps/api
WORKDIR /repo/apps/api
RUN pnpm build

# Runtime stage: production deps only, plus the compiled app and migrations.
FROM base AS runtime
ENV NODE_ENV=production
RUN apk add --no-cache openssl \
  && pnpm install --frozen-lockfile --prod --filter api... \
  && pnpm store prune
WORKDIR /repo/apps/api
COPY --from=build /repo/apps/api/dist ./dist
COPY apps/api/prisma ./prisma
COPY apps/api/prisma.config.ts ./
# The Prisma CLI downloads its schema engine on first use. Do it now, as root,
# because the node user cannot write to node_modules at runtime.
RUN ./node_modules/.bin/prisma version
USER node
EXPOSE 4000
# Apply pending migrations, then start. migrate deploy is a no-op when up to date.
CMD ["sh", "-c", "./node_modules/.bin/prisma migrate deploy && node dist/main"]
