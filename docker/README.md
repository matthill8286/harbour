# Harbour's images

The `Dockerfile` at the repository root builds three targets: `api`, `migrate` and `web`.
`split-modules.cjs` divides the api's production dependencies into the files the api loads
and the extra files only the Prisma CLI needs. `migrate` is the api's layers plus that one
extra layer.

## Database migrations

The `migrate` image runs `node prisma/migrate.cjs deploy`. It applies the migrations and
refuses a database that does not match them. See
[the database guide](../apps/api/prisma/README.md).

## The uploads volume

`api` and `migrate` run as the `node` user, uid and gid 1000. Earlier images ran as root, so
the live uploads volume and everything in it belongs to root. The new api can read those
files, but every upload fails with `EACCES` until the volume is given to uid 1000.

A new, empty volume needs no step, because the image's `/data/uploads` already belongs to
uid 1000.

### Ownership step

Run it in the stack folder on the server, after `compose.json` names the new images and
before the new api starts. Stop the old api first. It runs as root, so any folder it makes
after the `chown` would belong to root again.

```sh
cd /srv/impkt/private-preview
docker compose -f compose.json stop harbour-api
docker compose -f compose.json run --rm -T --no-deps --user root --entrypoint chown harbour-api -R 1000:1000 /data/uploads </dev/null
docker compose -f compose.json up -d --no-deps harbour-api harbour-web
```

It changes ownership only. It is safe to run again.

To check it, this must print nothing:

```sh
cd /srv/impkt/private-preview && docker compose -f compose.json exec -T harbour-api find /data/uploads ! -user node
```

### Rollback

Go back to the earlier images as before:

```sh
cd /path/to/impkt-hosting && bin/release-harbour.sh rollback <tag>
```

No ownership change is needed. The earlier api runs as root, so it can read and write files
that belong to uid 1000. Files it writes after the rollback belong to root, so run the
ownership step again the next time the new images are released.

To put the old ownership back anyway:

```sh
cd /srv/impkt/private-preview && docker compose -f compose.json run --rm -T --no-deps --user root --entrypoint chown harbour-api -R 0:0 /data/uploads </dev/null
```

If the ownership step fails during a release, the api is stopped. Run the rollback.

## Changes needed in `impkt-hosting`

`bin/release-harbour.sh`, in the `release` action, replace

```sh
$compose up -d --no-deps harbour-api harbour-web </dev/null
```

with

```sh
# The api runs as uid 1000. Stop the old one first, so it cannot make more root-owned folders.
$compose stop harbour-api </dev/null
$compose run --rm -T --no-deps --user root --entrypoint chown harbour-api -R 1000:1000 /data/uploads </dev/null
$compose up -d --no-deps harbour-api harbour-web </dev/null
```

This keeps the step in every release, which also covers a release that follows a rollback.
The api is down for the few seconds this takes. `upload`, `rollback` and `seed-demo` work
unchanged, and so do the `migrate` and `api` targets in `compose.yml`.

`seed-demo` also writes sample photos and documents. The `harbour-migrate` service has no
uploads volume, so those files are lost when the container exits, as they were before. To
keep them, add `harbour-uploads:/data/uploads` to that service's volumes, and run the
ownership step before the next seed.

## Pins

The `node` and `alpine` images are pinned by version and digest. The Node binary is copied
from the first into the second, so move both to the same Alpine release together. CI takes
its Node major from `.nvmrc` and fails if the `Dockerfile` uses a different one.
