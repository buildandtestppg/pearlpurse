#!/usr/bin/env python3
"""Repro: MAX button on a FUNDED wallet (deployed bundle BGubd0rs + mocked blockbook).
Mock: balance 10 PRL, ONE UTXO, fee rate 0.00555 PRL/kB — then user taps MAX and Review.
Exit code 0 = repro captured (whatever the outcome); prints the observable behavior."""
import base64, json, subprocess, sys, threading, time, urllib.request, pathlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROOT = pathlib.Path.home() / "Projects/pearlpurse"
DIST = ROOT / "dist"
PORT = 8788
CDP = 9334

# ---------------- mock blockbook + static server ----------------
import os
FUND_TXID = "ab" * 32
SCENARIO = os.environ.get("SCENARIO", "funded")          # funded | dust | race | fee-switch
UTXO_ADDR_PLACEHOLDER = "@ADDR@"
MOCK = {
    "balanceSat": "1000000000" if os.environ.get("SCENARIO","funded") != "dust" else os.environ.get("DUST_ATOMS","90000"),  # 10 PRL or dust
    "unconfirmedBalanceSat": "0",
    "txs": "0",
    "transactions": [{
        "txid": FUND_TXID, "confirmations": 12, "blockTime": 1790400000,
        "vin": [{"addresses": ["prl1pexternalexternalexternalexternalextern"], "value": "1100000000"}],
        "vout": [{"addresses": [UTXO_ADDR_PLACEHOLDER], "value": "1000000000" if os.environ.get("SCENARIO","funded") != "dust" else os.environ.get("DUST_ATOMS","90000")},
                 {"addresses": ["prl1psomewhereelse"], "value": "99000000"}],
        "fees": "1000000", "size": 250,
    }],
}
UTXOS = [{"txid": FUND_TXID, "vout": 0, "value": "1000000000" if os.environ.get("SCENARIO","funded") != "dust" else os.environ.get("DUST_ATOMS","90000"), "height": 120000, "confirmations": 12}]

FUNDED = {"addr": None}  # first-seen address gets the 10 PRL

class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *a): print("[http]", a[0] if a else fmt, flush=True)
    def _send(self, code, body, ctype="application/json"):
        b = body.encode() if isinstance(body, str) else body
        self.send_response(code); self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(b))); self.end_headers(); self.wfile.write(b)
    def do_GET(self):
        p = self.path
        if "/api/v1/estimatefee/" in p:
            if os.environ.get("SCENARIO") == "race": time.sleep(6)
            tgt = int(p.rstrip("/").split("/")[-1])
            curve = {1: "0.00607041", 2: "0.00575785", 5: "0.00010065", 10: "0.00001"}  # live Pearl values Sep 27
            return self._send(200, json.dumps({"result": curve.get(tgt, "0.00575785")}))
        if "/api/v2/utxo/" in p:
            addr = p.split("/api/v2/utxo/")[1].split("?")[0]
            if FUNDED["addr"] is None: FUNDED["addr"] = addr
            return self._send(200, json.dumps(UTXOS if addr == FUNDED["addr"] else []))
        if "/api/v2/address/" in p:
            addr = p.split("/api/v2/address/")[1].split("?")[0]
            if FUNDED["addr"] is None: FUNDED["addr"] = addr
            if addr != FUNDED["addr"]:
                return self._send(200, json.dumps({"balanceSat": "0", "unconfirmedBalanceSat": "0", "transactions": []}))
            m = json.loads(json.dumps(MOCK).replace(UTXO_ADDR_PLACEHOLDER, addr))
            return self._send(200, json.dumps(m))
        if p.rstrip("/") == "/api/v2":
            return self._send(200, json.dumps({"blockbook": {"bestHeight": 119536, "mempoolSize": 20,
                "inSync": True, "inSyncMempool": True}}))
        if "/api/v2/" in p:
            return self._send(200, "{}")
        # static
        f = DIST / (p.lstrip("/") or "index.html")
        if f.is_dir(): f = f / "index.html"
        if not f.exists(): f = DIST / "index.html"
        ctype = "text/html" if f.suffix == ".html" else "application/javascript" if f.suffix == ".js" else "text/css"
        self._send(200, f.read_bytes(), ctype)

# (simple threaded server inline instead:)
from http.server import ThreadingHTTPServer
httpd = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
threading.Thread(target=httpd.serve_forever, daemon=True).start()
print(f"[mock] blockbook+static on :{PORT}", flush=True)

# ---------------- headless chrome ----------------"
subprocess.run(["pkill", "-f", f"remote-debugging-port={CDP}"], capture_output=True); time.sleep(1)
chrome = subprocess.Popen(["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "--headless=new", "--remote-allow-origins=*", f"--remote-debugging-port={CDP}", "--no-first-run",
    "--user-data-dir=/tmp/cdp-profile-maxrepro", "--disable-gpu", "--window-size=390,844", "about:blank"],
    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(3)
import websocket
ws = websocket.create_connection(json.load(urllib.request.urlopen(f"http://127.0.0.1:{CDP}/json/list"))[0]["webSocketDebuggerUrl"], timeout=120)
mid, events = 0, []
def send(method, params=None):
    global mid
    mid += 1; ws.send(json.dumps({"id": mid, "method": method, "params": params or {}}))
    while True:
        msg = json.loads(ws.recv())
        if msg.get("id") == mid: return msg.get("result", {})
        if msg.get("method") in ("Runtime.consoleAPICalled", "Runtime.exceptionThrown"):
            events.append(msg)
def ev(expr):
    r = send("Runtime.evaluate", {"expression": expr, "awaitPromise": True, "returnByValue": True})
    if "exceptionDetails" in r: return "EVAL-EXC: " + json.dumps(r["exceptionDetails"])[:250]
    return r.get("result", {}).get("value")

send("Runtime.enable"); send("Page.enable")
send("Page.navigate", {"url": f"http://127.0.0.1:{PORT}/"})
time.sleep(5)
print("[ui] url:", ev("document.URL"), "ready:", ev("document.readyState"), "bodylen:", ev("document.body ? document.body.innerText.length : -1"), flush=True)
print("[ui] welcome:", str(ev("document.body.innerText.slice(0,90)"))[:90], flush=True)

# create wallet (password flow) OR unlock if a wallet from a previous run exists
body0 = str(ev("document.body.innerText"))
if "unlock" in body0.lower():
    ev("""(() => {
      const el = document.querySelector('input[type=password]');
      const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      s.call(el, 'testpass123'); el.dispatchEvent(new Event('input', {bubbles: true}));
    })()""")
    time.sleep(0.5)
    ev("[...document.querySelectorAll('button')].find(b => /unlock/i.test(b.textContent))?.click()")
    time.sleep(6)
    print("[ui] unlocked existing wallet", flush=True)
else:
    ev("[...document.querySelectorAll('button')].find(b => b.textContent.includes('Create new wallet'))?.click()"); time.sleep(1)
ev("""(() => {
  const cb = document.querySelector('input[type=checkbox]'); if (cb && !cb.checked) cb.click();
  const set = (el, v) => { const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set; s.call(el, v); el.dispatchEvent(new Event('input', {bubbles: true})); };
  const ins = [...document.querySelectorAll('input[type=password]')];
  if (ins.length >= 2) { set(ins[0], 'testpass123'); set(ins[1], 'testpass123'); return 'pw ok'; } return 'pw inputs: ' + ins.length;
})()""")
time.sleep(0.5)
ev("[...document.querySelectorAll('button')].find(b => /open wallet|encrypting/i.test(b.textContent))?.click()")
time.sleep(5)
print("[ui] after create:", str(ev("document.body.innerText.slice(0,160)"))[:160], flush=True)

# wait for mocked balance to land
for _ in range(20):
    body = str(ev("document.body.innerText"))
    if "10" in body and "PRL" in body: break
    time.sleep(1)
print("[ui] dashboard:", str(ev("document.body.innerText.slice(0,220)"))[:220], flush=True)

# open Send sheet
ev("[...document.querySelectorAll('button')].find(b => b.textContent.includes('Send'))?.click()"); time.sleep(1)

# need a valid recipient: derive from the repo's own lib
recipient = subprocess.run(["node", "--input-type=module", "-e", """
import('"""+str(ROOT)+"""/src/lib/pearl.js').then(async m => {
  const { HDKey } = await import('@scure/bip32');
  const { mnemonicToSeedSync } = await import('@scure/bip39');
  const root = HDKey.fromMasterSeed(mnemonicToSeedSync('abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'));
  console.log(m.addressFromPriv(m.derivePriv(root, 7)));
})"""], capture_output=True, text=True, cwd=ROOT)
RCPT = recipient.stdout.strip().splitlines()[-1]
print("[setup] recipient:", RCPT, "stderr:", recipient.stderr.strip()[:120] or "(none)", flush=True)
ev(f"""(() => {{
  const set = (el, v) => {{ const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set; s.call(el, v); el.dispatchEvent(new Event('input', {{bubbles: true}})); }};
  const inputs = [...document.querySelectorAll('.sheet input:not([type=checkbox]):not([type=password])')];
  const mono = inputs.find(i => i.className.includes('mono'));
  if (mono) set(mono, '{RCPT}'); return 'recipient set into ' + inputs.length + ' inputs';
}})()""")
time.sleep(0.5)

# >>> THE MOMENT: tap MAX <<<
before = ev("[...document.querySelectorAll('.sheet input')].map(i=>i.value).join('|')")
maxbtn = ev("[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'MAX')")
print("MAX disabled?", maxbtn and maxbtn.get("disabled"), flush=True)
ev("[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'MAX')?.click()")
time.sleep(1 if SCENARIO != "race" else 7)
after = ev("[...document.querySelectorAll('.sheet input')].map(i=>i.value).join('|')")
if SCENARIO == "fee-switch":
    ev("[...document.querySelectorAll('button')].find(b => b.textContent.trim().includes('Fast'))?.click()")
    time.sleep(1.5)
    after = ev("[...document.querySelectorAll('.sheet input')].map(i=>i.value).join('|')") + "  (after Fast)"
avail_fee = ev("document.querySelector('.sheet').innerText.match(/Available:[^\\n]*|Fee:[^\\n]*/g)?.join(' || ')")
print("=== MAX TAP ===", flush=True)
print("amount before:", before, flush=True)
print("amount after :", after, flush=True)
print("sheet info   :", avail_fee, flush=True)

# then Review — the moment of truth
ev("[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Review')?.click()")
time.sleep(1.5)
review = ev("document.querySelector('.sheet')?.innerText.slice(0, 420)")
print("=== AFTER REVIEW ===", flush=True)
print(str(review)[:420], flush=True)
err = ev("document.querySelector('.sheet .err')?.textContent")
print("error shown  :", str(err)[:200], flush=True)

# advisory panel: tap Receive PRL → sheet should swap
recv = ev("(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent.includes('Receive PRL')); if (!b) return 'no panel'; b.click(); return 'tapped'; })()")
time.sleep(1.2)
sheet_title = ev("document.querySelector('.sheet h3')?.textContent")
has_qr = ev("!!document.querySelector('.sheet img[src^=\"data:\"]')")
print("receive-tap:", recv, "| sheet now:", sheet_title, "| QR shown:", has_qr, flush=True)
# ---- v0.4.8: Sign/Verify sheets ----
sign_open = ev("(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent.includes('✍️ Sign')); if (!b) return 'NO SIGN BUTTON'; b.click(); return 'opened'; })()")
time.sleep(1)
print("sign sheet:", sign_open, "|", str(ev("document.querySelector('.sheet h3')?.textContent")), flush=True)
# type message into the sheet's textarea (first textarea)
ev("""(() => {
  const ta = document.querySelector('.sheet textarea');
  if (!ta) return 'NO TEXTAREA';
  const s = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
  s.call(ta, 'Mojo test proof Sep 27'); ta.dispatchEvent(new Event('input', {bubbles: true}));
  return 'typed';
})()""")
time.sleep(0.4)
ev("[...document.querySelectorAll('.sheet button')].find(b => b.textContent.includes('Sign with this address'))?.click()")
time.sleep(1.5)
sig = ev("document.querySelectorAll('.sheet textarea')[1]?.value || ''")
print("signature:", str(sig)[:80], flush=True)
# copy address for verify: close, open Verify, fill fields, run
ev("[...document.querySelectorAll('.sheet button')].find(b => b.textContent.trim() === '✕')?.click()")
time.sleep(0.6)
ev("[...document.querySelectorAll('button')].find(x => x.textContent.includes('🔍 Verify'))?.click()")
time.sleep(1)
ev("[...document.querySelectorAll('button')].find(x => x.textContent.includes('🔍 Verify'))?.click()")
time.sleep(1)
# full current address: open Receive sheet and read the copyline input
ev("[...document.querySelectorAll('button')].find(x => x.textContent.trim() === 'Receive')?.click()")
time.sleep(1.2)
addr_used = ev("[...document.querySelectorAll('.sheet input')].find(i => (i.value||'').startsWith('prl1'))?.value || ''")
ev("[...document.querySelectorAll('.sheet button')].find(b => b.textContent.trim() === '✕')?.click()")
time.sleep(0.6)
ev("[...document.querySelectorAll('button')].find(x => x.textContent.includes('🔍 Verify'))?.click()")
time.sleep(1)
fill = ev("""(() => {
  const ins = [...document.querySelectorAll('.sheet input, .sheet textarea')];
  if (ins.length < 3) return 'fields: ' + ins.length;
  const set = (el, v) => { const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v); el.dispatchEvent(new Event('input', {bubbles: true})); };
  set(ins[0], ARG_ADDR); set(ins[1], 'Mojo test proof Sep 27'); set(ins[2], ARG_SIG);
  return 'filled';
})()""".replace("ARG_ADDR", repr(addr_used or "")).replace("ARG_SIG", repr(sig or "")))
time.sleep(0.4)
ev("[...document.querySelectorAll('.sheet button')].find(b => b.textContent.trim() === '🔍 Verify')?.click()")
time.sleep(1)
verdict = ev("document.querySelector('.sheet')?.innerText.includes('Valid signature')")
print("verify verdict:", verdict, "|", fill, flush=True)
# ---- pearl: URI prefill (v0.4.9) ----
send("Page.navigate", {"url": f"http://127.0.0.1:{PORT}/pearl:pay?addr={RCPT}&amount=0.5&label=Test%20payment"})
time.sleep(5)
# unlock if locked (navigation re-locked the session)
body = str(ev("document.body.innerText"))
if "unlock" in body.lower():
    ev("""(() => {
      const el = document.querySelector('input[type=password]');
      const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      s.call(el, 'testpass123'); el.dispatchEvent(new Event('input', {bubbles: true}));
    })()""")
    time.sleep(0.5)
    ev("[...document.querySelectorAll('button')].find(b => /unlock/i.test(b.textContent))?.click()")
    time.sleep(6)
time.sleep(2)
sheet_h3 = ev("document.querySelector('.sheet h3')?.textContent")
inputs = ev("[...document.querySelectorAll('.sheet input')].map(i=>i.value.slice(0,20)).join('|')")
banner = ev("document.querySelector('.sheet')?.innerText.includes('Request:')")
print("URI prefill: sheet =", sheet_h3, "| inputs =", str(inputs)[:90], "| banner =", banner, flush=True)
print("=== console/exceptions ===", flush=True)
n = 0
for e in events:
    if e.get("method") == "Runtime.exceptionThrown":
        d = e["params"]["exceptionDetails"]; print("EXC:", d.get("text"), str(d.get("exception", {}).get("description", ""))[:200]); n += 1
    elif e.get("method") == "Runtime.consoleAPICalled" and e["params"]["type"] == "error":
        print("CONSOLE-ERR:", " ".join(str(a.get("value", ""))[:120] for a in e["params"].get("args", []))); n += 1
if n == 0: print("(none)")
httpd.shutdown(); chrome.terminate()
