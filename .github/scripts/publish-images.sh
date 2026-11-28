#!/usr/bin/env bash
# Pushes the images the checks ran to GitHub's container registry, and writes the release manifest
# that the release command in impkt-hosting reads. Nothing is rebuilt here.
#   COMMIT=<sha> OWNER=<lower-case owner> publish-images.sh <folder with images.tar.gz and ids.txt>
set -euo pipefail
folder="${1:?folder}"
commit="${COMMIT:?}"
owner="${OWNER:?}"
tag="${commit:0:12}"

gunzip -c "$folder/images.tar.gz" | docker load
manifest='{}'
for name in api migrate web; do
  local_image="impkt-harbour-$name:ci"
  expected="$(sed -n "s/^$name //p" "$folder/ids.txt")"
  actual="$(docker image inspect -f '{{.Id}}' "$local_image")"
  if [ -z "$expected" ] || [ "$actual" != "$expected" ]; then
    echo "$local_image is not the image that was checked: $actual, expected $expected." >&2
    exit 1
  fi
  remote="ghcr.io/$owner/harbour-$name"
  docker tag "$local_image" "$remote:$tag"
  docker push "$remote:$tag" | tee push.log
  digest="$(sed -n 's/.*digest: \(sha256:[0-9a-f]\{64\}\).*/\1/p' push.log | tail -1)"
  test -n "$digest"
  manifest="$(jq --arg name "impkt-harbour-$name" --arg ref "$remote@$digest" '. + {($name): $ref}' <<<"$manifest")"
done
jq -n --arg commit "$commit" --arg tag "$tag" --argjson images "$manifest" \
  '{commit: $commit, tag: $tag, images: $images}' | tee release-manifest.json
