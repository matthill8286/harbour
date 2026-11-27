# One recipe, three targets: api (NestJS), migrate (prisma db push and the demo seed)
# and web (the built SPA, served by Caddy with a fallback to index.html).
# The api and migrate images are plain Alpine with the Node binary, the api's production
# dependencies and its build output. migrate is the same files plus one layer holding the
# Prisma CLI, so the two share every other layer. Both run as the node user (uid 1000).
#
# Pins: keep the two Node/Alpine pins on the same Alpine release, because the Node binary
# is copied from one into the other.
FROM node:26.13.1-alpine3.24@sha256:6bd9ab43c0ec0190ca7b2d193906cb8b7edf6e7f4afa43ddeccd6452710bffb5 AS node

FROM node AS build
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true CHECKPOINT_DISABLE=1
RUN apk add --no-cache openssl && corepack enable
WORKDIR /app
# The manifests first, so a source change does not reinstall the dependencies.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm --filter @vip/shared build \
 && pnpm --filter @vip/api exec prisma generate \
 && pnpm --filter @vip/api build \
 && pnpm --filter @vip/web build
# A standalone copy of the api with production dependencies only, then its Prisma client.
# Only the files listed here are carried into the images.
RUN pnpm --filter @vip/api deploy --prod --legacy /deploy \
 && mkdir /out \
 && mv /deploy/node_modules /deploy/package.json /out/ \
 && shared="$(readlink -f /out/node_modules/@vip/shared)" \
 && rm -rf "$shared/src" "$shared/dist" \
 && cp -r packages/shared/dist "$shared/dist" \
 && cp -r apps/api/dist /out/dist \
 && cp -r apps/api/prisma /out/prisma \
 && rm /out/prisma/seed.ts \
 && find /out/dist -name '*.d.ts' -delete \
 && find /out/dist -name '*.map' -delete \
 && find /out/dist -name '*.tsbuildinfo' -delete \
 && (cd /out && /app/apps/api/node_modules/.bin/prisma generate --schema prisma/schema.prisma) \
 && node docker/split-modules.cjs /out /cli

FROM alpine:3.24.4@sha256:f59abe656b692d901e184be3445e084786602108599d2a51d229c0f5a48c71bf AS runtime-base
RUN apk add --no-cache ca-certificates libstdc++ openssl \
 && addgroup -g 1000 node \
 && adduser -u 1000 -G node -D node \
 && mkdir -p /data/uploads \
 && chown node:node /data/uploads
COPY --from=node /usr/local/bin/node /usr/local/bin/node

# Everything the api and migrate images share, least often changed first.
FROM runtime-base AS runtime
WORKDIR /app
COPY --from=build /out/node_modules ./node_modules
COPY --from=build /out/package.json ./package.json
COPY --from=build /out/prisma ./prisma
COPY --from=build /out/dist ./dist

FROM runtime AS migrate
COPY --from=build /cli/node_modules ./node_modules
RUN ln -s /app/node_modules/prisma/build/index.js /usr/local/bin/prisma
# The demo seed writes its sample files here. Mount the uploads volume to keep them.
ENV STORAGE_LOCAL_DIR=/data/uploads CHECKPOINT_DISABLE=1 PRISMA_HIDE_UPDATE_MESSAGE=1
USER node
# Fails rather than drop data: a destructive schema change needs a person to decide.
# The demo seed runs with: node dist/prisma/seed.js
CMD ["prisma", "db", "push", "--skip-generate"]

# An uploads volume that an earlier, root-run image wrote must be given to uid 1000
# before this image can write to it. See docker/README.md.
FROM runtime AS api
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3001 STORAGE_LOCAL_DIR=/data/uploads
USER node
EXPOSE 3001
# Nest emits dist/src/main.js because prisma/seed.ts is part of the compilation.
CMD ["node", "dist/src/main"]

FROM caddy:2.10.2-alpine@sha256:4c6e91c6ed0e2fa03efd5b44747b625fec79bc9cd06ac5235a779726618e530d AS web
COPY --from=build /app/apps/web/dist /srv
COPY apps/web/Caddyfile /etc/caddy/Caddyfile
