# One recipe, three targets: api (NestJS), migrate (prisma db push and the demo seed)
# and web (the built SPA, served by Caddy with a fallback to index.html).
# The api and migrate images carry only the api's production dependencies and build output.
# The compilers, dev dependencies and web sources stay in the build stage.
FROM node:24-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true
RUN corepack enable \
 && apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates python3 make g++ \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app

FROM base AS build
COPY . .
RUN pnpm install --frozen-lockfile \
 && pnpm --filter @vip/shared build \
 && pnpm --filter @vip/api exec prisma generate \
 && pnpm --filter @vip/api build \
 && pnpm --filter @vip/web build
# A standalone copy of the api with production dependencies only, then its Prisma client.
RUN pnpm --filter @vip/api deploy --prod --legacy /out \
 && rm -rf /out/node_modules/@vip/shared/src \
 && cp -r packages/shared/dist /out/node_modules/@vip/shared/dist \
 && cp -r apps/api/dist /out/dist \
 && cp -r apps/api/prisma /out/prisma \
 && cd /out \
 && /app/apps/api/node_modules/.bin/prisma generate --schema prisma/schema.prisma \
 && rm -rf /out/src /out/test

FROM node:24-slim AS runtime
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /out /app

FROM runtime AS migrate
ARG PRISMA_VERSION=6.19.3
RUN npm install -g "prisma@${PRISMA_VERSION}" && npm cache clean --force
# Fails rather than drop data: a destructive schema change needs a person to decide.
# The demo seed runs with: node dist/prisma/seed.js
CMD ["prisma", "db", "push", "--skip-generate"]

FROM runtime AS api
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3001 STORAGE_LOCAL_DIR=/data/uploads
EXPOSE 3001
# Nest emits dist/src/main.js because prisma/seed.ts is part of the compilation.
CMD ["node", "dist/src/main"]

FROM caddy:2.10-alpine AS web
COPY --from=build /app/apps/web/dist /srv
RUN printf ':80 {\n\troot * /srv\n\tencode zstd gzip\n\ttry_files {path} /index.html\n\tfile_server\n}\n' > /etc/caddy/Caddyfile
