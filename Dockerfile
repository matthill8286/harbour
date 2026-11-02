# One recipe, three targets: api (NestJS), migrate (prisma db push, once per release)
# and web (the built SPA, served by Caddy with a fallback to index.html).
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

FROM build AS migrate
WORKDIR /app/apps/api
# Fails rather than drop data: a destructive schema change needs a person to decide.
CMD ["sh", "-c", "pnpm exec prisma db push --skip-generate"]

FROM build AS api
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3001 STORAGE_LOCAL_DIR=/data/uploads
WORKDIR /app/apps/api
EXPOSE 3001
# Nest emits dist/src/main.js because prisma/seed.ts is part of the compilation.
CMD ["node", "dist/src/main"]

FROM caddy:2.10-alpine AS web
COPY --from=build /app/apps/web/dist /srv
RUN printf ':80 {\n\troot * /srv\n\tencode zstd gzip\n\ttry_files {path} /index.html\n\tfile_server\n}\n' > /etc/caddy/Caddyfile
