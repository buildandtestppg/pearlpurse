// prlstats relay — same-origin proxy for prlstats.com public JSON (price/hashrate/difficulty/pools).
// Cache 5 min server-side (their snapshot refreshes ~minutely; we don't need faster).
// Attribution: data originates from https://prlstats.com (BETA, by @jeremiahrogers).

const UPSTREAM = "https://prlstats.com";
const ALLOWED = new Set(["/api/status", "/api/pools", "/api/difficulty", "/api/summary"]);
let cache = { key: "", at: 0, body: null, ct: "application/json" };

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "method not allowed" });
  const url = new URL(req.url, "https://x.local");
  const path = url.pathname.replace(/^\/api\/prlstats/, "");
  if (!ALLOWED.has(path)) return res.status(400).json({ error: "bad path" });
  const key = path + url.search;
  if (cache.key === key && Date.now() - cache.at < 300_000) {
    res.setHeader("Content-Type", cache.ct);
    res.setHeader("X-Cache", "hit");
    return res.status(200).send(cache.body);
  }
  try {
    const r = await fetch(UPSTREAM + path + url.search, {
      headers: { "User-Agent": "PearlPurse-relay/1.0 (+https://pearlpurse.vercel.app)" },
      signal: AbortSignal.timeout(8000),
    });
    const body = await r.text();
    if (body.length > 256 * 1024) return res.status(502).json({ error: "upstream too large" });
    cache = { key, at: Date.now(), body, ct: r.headers.get("content-type") || "application/json" };
    res.setHeader("Content-Type", cache.ct);
    res.setHeader("X-Cache", "miss");
    res.setHeader("Cache-Control", "public, max-age=300");
    res.status(r.status).send(body);
  } catch (e) {
    res.status(502).json({ error: "upstream unavailable" });
  }
}
