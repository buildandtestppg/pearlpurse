#!/usr/bin/env bash
# Reproducible release: build, checksum, publish releases.json, optional deploy.
# Usage: bash scripts/release.sh [--deploy]
set -euo pipefail
cd "$(dirname "$0")/.."

VERSION=$(node -p "require('./package.json').version")
echo "▶ building v$VERSION (deterministic: vite hashes content)"
npm run build >/dev/null

BUNDLE=$(grep -o 'index-[^"]*\.js' dist/index.html | head -1)
SHA=$(shasum -a 256 "dist/assets/$BUNDLE" | cut -d' ' -f1)
DATE=$(date -u +%Y-%m-%dT%H:%M:%SZ)

python3 - "$VERSION" "$BUNDLE" "$SHA" "$DATE" <<'PY'
import json, sys, pathlib
v, bundle, sha, date = sys.argv[1:5]
p = pathlib.Path('public/releases.json')
rs = json.loads(p.read_text()) if p.exists() else []
rs = [r for r in rs if r['version'] != v] + [{"version": v, "bundle": bundle, "sha256": sha, "date": date}]
p.write_text(json.dumps(rs, indent=2) + "\n")
print(f"published: v{v} {bundle} sha256={sha[:16]}… ({len(rs)} releases tracked)")
PY

if [ "${1:-}" = "--deploy" ]; then
  echo "▶ deploying"
  bash deploy.sh
else
  echo "(dry run — pass --deploy to ship; releases.json is already updated for the next deploy)"
fi
