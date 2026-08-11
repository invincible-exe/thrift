#!/usr/bin/env bash
# Mirrors public/models/*.glb to the public `models` bucket on Supabase
# Storage so the hero model loads from Supabase's CDN (full size, full
# speed) instead of traveling through a tunnel that can truncate it.
#
# Usage: bash scripts/upload-models.sh
# Requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local.
set -euo pipefail
cd "$(dirname "$0")/.."

URL=$(grep '^NEXT_PUBLIC_SUPABASE_URL=' .env.local | cut -d= -f2- | tr -d '"')
KEY=$(grep '^SUPABASE_SERVICE_ROLE_KEY=' .env.local | cut -d= -f2- | tr -d '"')

if [ -z "$URL" ] || [ -z "$KEY" ]; then
  echo "ERROR: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env.local" >&2
  exit 1
fi

echo "--- ensure models bucket exists ---"
curl -s --max-time 15 -X POST -H "apikey: $KEY" -H "Authorization: Bearer $KEY" \
  -H 'Content-Type: application/json' \
  -d '{"name":"models","public":true,"file_size_limit":26214400,"allowed_mime_types":["model/gltf-binary","application/octet-stream"]}' \
  "$URL/storage/v1/bucket" >/dev/null || true # "already exists" is fine

for f in public/models/*.glb; do
  name=$(basename "$f")
  echo "--- uploading $name ---"
  curl -s --fail --max-time 300 -X POST \
    -H "apikey: $KEY" -H "Authorization: Bearer $KEY" \
    -H 'Content-Type: model/gltf-binary' \
    --data-binary "@$f" \
    "$URL/storage/v1/object/models/$name" >/dev/null
done

echo "All models uploaded. Public base URL:"
echo "$URL/storage/v1/object/public/models/"
