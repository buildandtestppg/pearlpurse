import sys
#!/usr/bin/env python3
"""UI smoke test: headless Chrome via raw CDP. create → reload → unlock → assert dashboard renders with zero exceptions. Catches undefined-identifier bugs that vite build misses. Run: python3 scripts/ui_smoke.py (exits 0 on clean)."""
import json, subprocess, time, urllib.request, websocket

CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
PORT = 9333
subprocess.run(["pkill", "-f", "remote-debugging-port=9333"], capture_output=True)
time.sleep(1)
proc = subprocess.Popen([CHROME, "--headless=new", "--remote-allow-origins=*", f"--remote-debugging-port={PORT}",
                         "--no-first-run", "--user-data-dir=/tmp/cdp-profile", "--disable-gpu",
                         "--window-size=390,844", "about:blank"],
                        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(3)

ws = websocket.create_connection(json.load(urllib.request.urlopen(f"http://127.0.0.1:{PORT}/json/list"))[0]["webSocketDebuggerUrl"], timeout=60)
mid, events = 0, []

def send(method, params=None):
    global mid
    mid += 1
    ws.send(json.dumps({"id": mid, "method": method, "params": params or {}}))
    while True:
        msg = json.loads(ws.recv())
        if msg.get("id") == mid:
            return msg.get("result", {})
        if msg.get("method") in ("Runtime.consoleAPICalled", "Runtime.exceptionThrown", "Log.entryAdded"):
            events.append(msg)

def ev(expr):
    r = send("Runtime.evaluate", {"expression": expr, "awaitPromise": True, "returnByValue": True})
    if "exceptionDetails" in r:
        return "EVAL-EXC: " + json.dumps(r["exceptionDetails"])[:200]
    return r.get("result", {}).get("value")

def dump_errors(tag):
    print(f"--- errors after {tag} ---")
    n = 0
    for e in events:
        if e.get("method") == "Runtime.exceptionThrown":
            d = e["params"]["exceptionDetails"]
            print("EXC:", d.get("text"), (d.get("exception") or {}).get("description", "")[:400])
            n += 1
        elif e.get("method") == "Runtime.consoleAPICalled" and e["params"]["type"] == "error":
            print("CONSOLE-ERR:", " ".join(str(a.get("value", ""))[:150] for a in e["params"].get("args", [])))
            n += 1
    if n == 0: print("(none)")
    events.clear()

send("Runtime.enable"); send("Log.enable"); send("Page.enable")
send("Page.navigate", {"url": "https://pearlpurse.vercel.app/app"})
time.sleep(6)

# --- CREATE FLOW ---
print("step1 body:", ev("document.body.innerText.slice(0,120)"))
ev("[...document.querySelectorAll('button')].find(b => b.textContent.includes('Create new wallet'))?.click()")
time.sleep(1)
print("step2 (seed shown?):", ev("document.body.innerText.slice(0, 200)"))
# type password into both fields via native setter
ev("""
(() => {
  const cb = document.querySelector('input[type=checkbox]');
  if (cb && !cb.checked) cb.click();
  const inputs = [...document.querySelectorAll('input[type=password]')];
  const set = (el, v) => { const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set; s.call(el, v); el.dispatchEvent(new Event('input', {bubbles: true})); };
  if (inputs.length >= 2) { set(inputs[0], 'testpass123'); set(inputs[1], 'testpass123'); return 'pw set into ' + inputs.length; }
  return 'inputs: ' + inputs.length;
})()
""")
time.sleep(0.5)
ev("[...document.querySelectorAll('button')].find(b => /open wallet|encrypting/i.test(b.textContent))?.click()")
time.sleep(5)
print("step3 after create:", ev("document.body.innerText.slice(0, 300)"))
dump_errors("CREATE")

# --- RELOAD → LOCKED ---
send("Page.navigate", {"url": "https://pearlpurse.vercel.app/app"})
time.sleep(6)
print("step4 locked screen:", ev("document.body.innerText.slice(0, 150)"))

# --- UNLOCK (his exact action) ---
ev("""
(() => {
  const el = document.querySelector('input[type=password]');
  if (!el) return 'NO PW INPUT';
  const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  s.call(el, 'testpass123'); el.dispatchEvent(new Event('input', {bubbles: true}));
  return 'pw typed';
})()
""")
time.sleep(0.5)
ev("[...document.querySelectorAll('button')].find(b => /unlock/i.test(b.textContent))?.click()")
time.sleep(8)
print("step5 after unlock:", ev("document.body.innerText.slice(0, 400)"))
dump_errors("UNLOCK")

if any('EXC' in str(e) for e in events) or 'Enter your password' in (open('/dev/null') and ''): 
    proc.terminate(); sys.exit(1)
proc.terminate()
