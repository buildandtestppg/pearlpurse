// PearlPurse CORS relay — Cloudflare Worker.
// Forwards GET/POST to Pearl's Blockbook indexer and injects CORS headers.
// Stateless: no logging, no storage — keys never touch this worker (browser signs locally).
// Allowlist blocks open-proxy abuse.

const UPSTREAM = "https://blockbook.pearlresearch.ai";
const ALLOWED_ORIGINS = [
  "https://pearlpurse.vercel.app",
  "http://localhost:5173",
  "http://localhost:4173",
];

function corsHeaders(origin) {
  const allow = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
  };
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin") || "";

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    // only proxy /api/* paths, block everything else
    if (!url.pathname.startsWith("/api/")) {
      return new Response("not found", { status: 404, headers: corsHeaders(origin) });
    }

    const target = UPSTREAM + url.pathname.replace(/^\/api/, "/api") + url.search;
    const resp = await fetch(target, {
      method: request.method,
      headers: { "Content-Type": request.headers.get("Content-Type") || "text/plain" },
      body: request.method === "POST" ? request.body : undefined,
    });
    const text = await resp.text();
    return new Response(text, {
      status: resp.status,
      headers: { ...corsHeaders(origin), "Content-Type": resp.headers.get("Content-Type") || "application/json" },
    });
  },
};
