#!/bin/bash
# Deploy pearlpurse via V13 API (proven path) — includes api/ serverless fn + dist
set -e
cd ~/Projects/pearlpurse
npm run build 2>&1 | grep built

python3 - <<'PY'
import json, base64, os, pathlib
files = []
for f in pathlib.Path("dist").rglob("*"):
    if f.is_file():
        files.append({"file": str(f.relative_to("dist")), "data": base64.b64encode(f.read_bytes()).decode(), "encoding": "base64"})
for f in pathlib.Path("api").rglob("*"):
    if f.is_file():
        files.append({"file": str(f), "data": base64.b64encode(f.read_bytes()).decode(), "encoding": "base64"})
files.append({"file": "vercel.json", "data": base64.b64encode(open("vercel.json","rb").read()).decode(), "encoding": "base64"})
payload = {"name": "pearlpurse", "files": files, "projectSettings": {"framework": None}, "target": "production"}
json.dump(payload, open("/tmp/pearlpurse_payload.json", "w"))
print("payload files:", [f["file"] for f in files])
PY

TOKEN=$(python3 -c 'import json,os; print(json.load(open(os.path.expanduser("~/.vercel/auth.json")))["token"])')
DEP=$(curl -s -X POST "https://api.vercel.com/v13/deployments?skipAutoDetectionConfirmation=1&teamId=team_hZz3jr6e4xqPVSbjoiyIdYcr" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d @/tmp/pearlpurse_payload.json | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('id'), d.get('url'), d.get('error'))")
echo "deploy: $DEP"
DID=$(echo $DEP | cut -d' ' -f1)
sleep 5
curl -s -X POST "https://api.vercel.com/v2/deployments/$DID/aliases?teamId=team_hZz3jr6e4xqPVSbjoiyIdYcr" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"alias":"pearlpurse.vercel.app"}' | python3 -c "import sys,json; print('alias resp:', json.load(sys.stdin).get('alias', 'ERR'))"
echo "waiting for build..."
for i in $(seq 1 20); do
  sleep 6
  STATUS=$(curl -s "https://api.vercel.com/v13/deployments/$DID?teamId=team_hZz3jr6e4xqPVSbjoiyIdYcr" -H "Authorization: Bearer $TOKEN" | python3 -c "import sys,json; print(json.load(sys.stdin).get('readyState','?'))")
  echo "  status: $STATUS"
  [ "$STATUS" = "READY" ] && break
done
sleep 3
echo "=== LIVE CHECK ==="
curl -s -o /dev/null -w "site: %{http_code}\n" "https://pearlpurse.vercel.app/"
curl -s -o /dev/null -w "same-origin api: %{http_code}\n" "https://pearlpurse.vercel.app/api/v2/api-status"
curl -s "https://pearlpurse.vercel.app/api/v2/address/prl1p2nlcavdnzq4sl9gh6q92tu7neznz2df4cux5f68umkpapkd3ha4qlknklv" | head -c 100
echo
