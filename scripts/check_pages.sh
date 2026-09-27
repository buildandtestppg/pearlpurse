#!/usr/bin/env bash
# Content-based page verification (status codes lie — rewrites can shadow static pages).
# Run after every deploy: bash scripts/check_pages.sh
set -euo pipefail
BASE="${1:-https://pearlpurse.vercel.app}"
fail=0
check() { # path, grep-pattern, label
  if curl -s --max-time 15 "$BASE$1" | grep -q "$2"; then echo "✓ $3"; else echo "✗ $3 — CONTENT MISSING at $1"; fail=1; fi
}
check "/" "id=\"root\"" "SPA shell"
check "/get-started" "wallet for" "get-started landing"
check "/security" "Threat model" "security page"
check "/roadmap" "Public and versioned" "roadmap page"
check "/manifest.json" "PearlPurse" "PWA manifest"
check "/releases.json" "sha256" "releases feed"
check "/security-builds.js" "getElementById" "builds script"
JS=$(curl -s "$BASE/" | grep -o 'index-[^"]*\.js' | head -1)
if [ -n "$JS" ] && curl -s -o /dev/null --max-time 15 "$BASE/assets/$JS"; then echo "✓ bundle $JS served"; else echo "✗ bundle missing"; fail=1; fi
exit $fail
