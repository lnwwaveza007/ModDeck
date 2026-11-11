# Production image for apps/web (Next.js standalone output). Build from the repo root:
#   docker build -f docker/web.Dockerfile -t moddeck-web .
FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile --filter web...
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
RUN pnpm --filter @moddeck/shared build
COPY apps/web apps/web

# NEXT_PUBLIC_* values are inlined at build time. The default is a relative
# path, so one image works behind Nginx on any host.
# NEXT_PUBLIC_BASE_PATH is the URL prefix when a proxy mounts the app below the site
# root (e.g. /capstone26/cp26ssa2); then NEXT_PUBLIC_API_URL is "<prefix>/api".
ARG NEXT_PUBLIC_API_URL=/api
ARG NEXT_PUBLIC_BASE_PATH=
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL} \
  NEXT_PUBLIC_BASE_PATH=${NEXT_PUBLIC_BASE_PATH}
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /repo/apps/web
RUN pnpm build

# Runtime stage: only the standalone server and static assets.
FROM node:22-alpine AS runtime
ENV NODE_ENV=production \
  NEXT_TELEMETRY_DISABLED=1 \
  HOSTNAME=0.0.0.0 \
  PORT=3000
WORKDIR /app
COPY --from=build --chown=node:node /repo/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=node:node /repo/apps/web/public ./apps/web/public
USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
