import { verifyMessage } from "./lib/pearl.js";

document.getElementById("go").addEventListener("click", () => {
  const inp = document.getElementById("inp").value.trim();
  const out = document.getElementById("res");
  out.style.display = "block";
  let addr = "", msg = "", sig = "";
  try {
    if (inp.startsWith("{")) {
      const j = JSON.parse(inp);
      if (j.kind !== "pearlpurse-proof-of-funds") throw new Error("Not a proof-of-funds envelope");
      addr = j.address; msg = j.message; sig = j.sig;
    } else {
      const parts = inp.split(/\n\s*\n|\n/).map((x) => x.trim()).filter(Boolean);
      if (parts.length < 3) throw new Error("Paste an envelope JSON, or message + signature + address lines");
      sig = parts[parts.length - 2];
      addr = parts[parts.length - 1];
      msg = parts.slice(0, parts.length - 2).join("\n");
    }
    if (!/^prl1/i.test(addr)) throw new Error("Not a prl1… address");
    if (!/^[0-9a-fA-F]{128}$/.test(sig)) throw new Error("Signature must be 64-byte hex (128 chars)");
    const ok = verifyMessage(addr, msg, sig);
    out.className = "res " + (ok ? "ok" : "bad");
    const m = msg.match(/balance: ([^\n]+)|as-of: ([^\n]+)/g) || [];
    out.innerHTML = (ok ? "<div style=\"font-size:34px\">✅</div><div style=\"font-weight:700;margin:4px 0\">Valid proof</div>"
                        : "<div style=\"font-size:34px\">❌</div><div style=\"font-weight:700;margin:4px 0\">Invalid</div>")
      + "<div class=\"small\" style=\"color:var(--muted);margin-bottom:8px\">" + (ok ? "Signature matches this address and message." : "Address, message or signature does not match.") + "</div>"
      + "<div class=\"card\">"
      + "<div class=\"kv\"><span class=\"k\">Address</span><span class=\"mono\" style=\"font-size:11px;word-break:break-all\">" + addr + "</span></div>"
      + (m.length ? "<div class=\"kv\"><span class=\"k\">Claims</span><span style=\"font-size:11px;text-align:right\">" + m.join("<br>") + "</span></div>" : "")
      + "<div class=\"kv\"><span class=\"k\">Note</span><span class=\"small\">signature proves address control; balance claim reflects the signed snapshot, re-check on-chain if material</span></div>"
      + "</div>";
  } catch (e) {
    out.className = "res bad";
    out.innerHTML = "<div style=\"font-size:26px\">⚠️</div><div>" + String(e.message).slice(0, 200) + "</div>";
  }
});
