#!/usr/bin/env bash
# Bundles the mcp Edge Function (with packages/schema, the engine bundle and _shared) into one minified file for
# deploying through the Supabase MCP tool, whose payload is pasted inline: 127 KB of sources is too much to paste,
# the bundle is a fraction. npm packages stay external (resolved by Deno at deploy). The repo keeps the real source.
set -euo pipefail
cd "$(dirname "$0")/.."
out="${1:-/tmp/mcp.bundle.js}"
node_modules/.bin/esbuild supabase/functions/mcp/index.ts --bundle --format=esm --platform=neutral --minify --legal-comments=none \
  --alias:@fit-check/schema=./packages/schema/src \
  --alias:zod=npm:zod@3.23.8 --alias:@supabase/supabase-js=npm:@supabase/supabase-js@2.119.0 --alias:jose=npm:jose@5.9.6 \
  --external:npm:* --external:https://* --outfile="$out"
