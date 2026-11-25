#!/usr/bin/env bash
# Bundles the mcp Edge Function (with packages/schema, the engine bundle and _shared) into one minified file for
# deploying through the Supabase MCP tool, whose payload is pasted inline: 127 KB of sources is too much to paste,
# the bundle is a fraction. npm packages stay external (resolved by Deno at deploy). The repo keeps the real source.
# --charset=utf8 on purpose: the deploy tool carries the bundle as a JSON string, and a transport that decodes \uXXXX
# changes the file. esbuild's default ASCII output turns every non-ASCII character into such an escape; U+2028/U+2029
# decode to line terminators, which broke a regex literal ("Unterminated regexp literal", 2026-11-19). With utf8 the
# bundle holds no escapes at all. The check at the end fails the script if one appears, or a raw line separator or
# control character does.
set -euo pipefail
cd "$(dirname "$0")/.."
out="${1:-/tmp/mcp.bundle.js}"
# don't touch / every bare npm import the mcp function reaches must have an alias here, matching the version in
# supabase/functions/deno.json; a missing one fails the build ("Could not resolve", aws4fetch on 2026-11-25).
node_modules/.bin/esbuild supabase/functions/mcp/index.ts --bundle --format=esm --platform=neutral --minify --legal-comments=none \
  --alias:@fit-check/schema=./packages/schema/src \
  --alias:zod=npm:zod@3.23.8 --alias:@supabase/supabase-js=npm:@supabase/supabase-js@2.119.0 --alias:jose=npm:jose@5.9.6 --alias:aws4fetch=npm:aws4fetch@1.0.20 \
  --charset=utf8 --external:npm:* --external:https://* --outfile="$out"

# Guard: nothing in the bundle may change in a JSON/escape round trip. No backslash-u sequence (checked as text),
# no raw U+2028/U+2029, no control characters U+0000-U+0008 (tab, LF, CR stay legal).
python3 -I - "$out" <<'PY'
import re, sys
raw = open(sys.argv[1], "rb").read()
text = raw.decode("utf-8")
bad = []
if re.search(r"\\u[0-9A-Fa-f]{4}|\\u\{", text): bad.append("a backslash-u escape")
if "\u2028" in text or "\u2029" in text: bad.append("a raw U+2028/U+2029")
if re.search("[\x00-\x08]", text): bad.append("a control character")
if bad:
    sys.exit("bundle-mcp: bundle contains " + ", ".join(bad) + "; it would not survive the deploy transport")
PY
