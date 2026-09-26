// Permanent Blockbook relay — Vercel serverless function, same-origin as the app.
// Classic Node handler (max compatibility). No state, no key material (public data only).
const UPSTREAM = "https://blockbook.pearlresearch.ai";

export default async function handler(req, res) {
  const url = new URL(req.url, "https://x.local");
  const target = UPSTREAM + url.pathname + url.search;
  try {
    const init = { method: req.method, headers: {}, signal: AbortSignal.timeout(12000) };
    if (req.method === "POST") {
      const chunks = [];
      for await (const c of req) chunks.push(c);
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
