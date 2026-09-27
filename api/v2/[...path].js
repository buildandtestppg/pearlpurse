// Permanent Blockbook relay — Vercel serverless function, same-origin as the app.
// Classic Node handler (max compatibility). No state, no key material (public data only).
const UPSTREAM = "https://blockbook.pearlresearch.ai";
// Failover cache: remember last good GET responses; if upstream dies, serve
// stale copies (max 10 min old) with X-Pearlpurse-Stale headers so the UI can say so.
const stale = new Map(); // path -> { body, ct, at }
const STALE_MAX_MS = 600_000;

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ error: "method not allowed" });
  }
  const url = new URL(req.url, "https://x.local");
  // SSRF guard: only /api/v1/ and /api/v2/ paths forward (path already starts /api/v2; v1 fn mirrors)
  if (!/^\/api\/v\d+\//.test(url.pathname)) {
    return res.status(400).json({ error: "bad path" });
  }
  if (url.pathname.includes("..")) {
    return res.status(400).json({ error: "bad path" });
  }
  const target = UPSTREAM + url.pathname + url.search;
  const hit = stale.get(url.pathname + url.search);
  if (req.method === "GET" && hit && Date.now() - hit.at > STALE_MAX_MS) stale.delete(url.pathname + url.search);
  try {
    const init = { method: req.method, headers: {}, signal: AbortSignal.timeout(12000) };
    if (req.method === "POST") {
      const chunks = [];
      let size = 0;
      for await (const c of req) {
        size += c.length;
        if (size > 128 * 1024) { // max signed tx ~100KB; refuse bigger
          return res.status(413).json({ error: "payload too large" });
        }
        chunks.push(c);
      }
      init.body = Buffer.concat(chunks).toString("utf8");
      init.headers["Content-Type"] = "text/plain";
    }
    const r = await fetch(target, init);
    const body = await r.arrayBuffer();
    res.setHeader("Content-Type", r.headers.get("content-type") || "application/json");
    res.setHeader("Cache-Control", "no-store");
    res.status(r.status).send(Buffer.from(body));
  } catch (e) {
    res.status(502).json({ error: "upstream", detail: String(e.message || e).slice(0, 200) });
  }
}
