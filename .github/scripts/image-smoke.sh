#!/usr/bin/env bash
# Runs the built api, migrate and web images against a throwaway PostgreSQL.
#   IMAGE_TAG=<tag> .github/scripts/image-smoke.sh
# Expects impkt-harbour-{api,migrate,web}:<tag>. Removes everything it starts.
set -euo pipefail
tag="${IMAGE_TAG:?set IMAGE_TAG}"
run="harbour-smoke-$$"
cleanup() {
  docker rm -f -v "$run-db" "$run-api" "$run-web" >/dev/null 2>&1 || true
  docker volume rm "$run-uploads" >/dev/null 2>&1 || true
  docker network rm "$run" >/dev/null 2>&1 || true
}
trap cleanup EXIT
fail() { echo "$1" >&2; exit 1; }

# Download size: the compressed layers, which is what a server pulls.
for target in api migrate web; do
  bytes="$(docker save "impkt-harbour-$target:$tag" | gzip -6 | wc -c)"
  echo "impkt-harbour-$target: $((bytes / 1000000)) MB compressed"
  [ "$bytes" -le 150000000 ] || fail "impkt-harbour-$target is over 150 MB compressed."
done
for target in api migrate; do
  uid="$(docker run --rm --entrypoint id "impkt-harbour-$target:$tag" -u)"
  [ "$uid" = 1000 ] || fail "impkt-harbour-$target runs as uid $uid, not 1000."
done

password="$(openssl rand -hex 24)"
env_args=(-e "DATABASE_URL=postgresql://vip:$password@db:5432/vehicle_import?schema=public")
docker network create "$run" >/dev/null
docker run -d --name "$run-db" --network "$run" --network-alias db \
  -e POSTGRES_USER=vip -e "POSTGRES_PASSWORD=$password" -e POSTGRES_DB=vehicle_import \
  postgis/postgis:16-3.4 >/dev/null
# Over TCP, because the image's first-start server listens on the socket only.
for _ in $(seq 1 60); do
  docker exec "$run-db" pg_isready -q -h 127.0.0.1 -U vip -d vehicle_import && break
  sleep 1
done

echo "migrate: db push"
docker run --rm --network "$run" "${env_args[@]}" "impkt-harbour-migrate:$tag"

echo "migrate: demo seed"
docker volume create "$run-uploads" >/dev/null
docker run --rm --network "$run" "${env_args[@]}" -v "$run-uploads:/data/uploads" \
  -e "SEED_ADMIN_PASSWORD=$(openssl rand -hex 16)" \
  -e "SEED_STAFF_PASSWORD=$(openssl rand -hex 16)" \
  -e "SEED_CUSTOMER_PASSWORD=$(openssl rand -hex 16)" \
  "impkt-harbour-migrate:$tag" node dist/prisma/seed.js

echo "api: health and uploads volume"
docker run -d --name "$run-api" --network "$run" "${env_args[@]}" \
  -e "JWT_SECRET=$(openssl rand -hex 32)" \
  -e "TWO_FACTOR_ENCRYPTION_KEY=$(openssl rand -hex 32)" \
  -v "$run-uploads:/data/uploads" "impkt-harbour-api:$tag" >/dev/null
healthy=""
for _ in $(seq 1 60); do
  if docker exec "$run-api" node -e "fetch('http://127.0.0.1:3001/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"; then
    healthy=yes; break
  fi
  sleep 1
done
[ -n "$healthy" ] || { docker logs "$run-api" >&2; fail "The api did not become healthy."; }
docker exec "$run-api" sh -c 'set -e; f="$(find /data/uploads -type f | head -1)"; test -r "$f"; mkdir /data/uploads/smoke; echo ok > /data/uploads/smoke/file'

# sharp and the HEIC decoder are native and WebAssembly code, so they are run in the image itself,
# as its own user: a HEIC photo with a location in it must become a JPEG without one.
echo "api: photo copies"
docker exec -i "$run-api" sh -c 'cat > /tmp/photo.heic' < apps/api/test/fixtures/gps-photo.heic
docker exec "$run-api" node -e '
const { readFileSync } = require("node:fs");
const { render } = require("/app/dist/src/integrations/image-renditions");
(async () => {
  const photo = readFileSync("/tmp/photo.heic");
  if (!photo.includes("FixtureCam")) throw new Error("The fixture has no metadata.");
  for (const copy of await render(photo, "image/heic", ["thumb", "display", "clean"])) {
    if (copy.readUInt16BE(0) !== 0xffd8) throw new Error("A copy is not a JPEG.");
    if (copy.includes("FixtureCam") || copy.includes("Exif")) throw new Error("A copy has metadata.");
    const [again] = await render(copy, "image/jpeg", ["thumb"]);
    if (!again.length) throw new Error("A JPEG could not be resized.");
  }
})().catch((error) => { console.error(error); process.exit(1); });
' || fail "The api image could not make photo copies."

echo "web: serves the app"
docker run -d --name "$run-web" --network "$run" "impkt-harbour-web:$tag" >/dev/null
for _ in $(seq 1 30); do
  docker exec "$run-web" wget -q -O /dev/null http://127.0.0.1/login 2>/dev/null && break
  sleep 1
done
docker exec "$run-web" wget -q -O /dev/null http://127.0.0.1/login
echo "The images passed."
