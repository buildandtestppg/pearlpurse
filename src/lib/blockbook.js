// Blockbook client — browser talks via CORS relay, Node (tests) goes direct.
const DIRECT = "https://blockbook.pearlresearch.ai/api/v2";
const RELAY = "/api/v2"; // same-origin Vercel function (permanent, no CORS)
const PROXY = RELAY;

function base() {
  return typeof window === "undefined" ? DIRECT : PROXY;
}

async function get(path) {
  const r = await fetch(base() + path);
  if (!r.ok) throw new Error(`blockbook ${path}: HTTP ${r.status}`);
  return r.json();
}

async function post(path, body) {
  const r = await fetch(base() + path, { method: "POST", body });
  if (!r.ok) {
    let detail = "";
    try { detail = (await r.json()).error || ""; } catch {}
    throw new Error(`blockbook ${path}: HTTP ${r.status} ${detail}`);
  }
  return r.json();
}

export async function getAddressInfo(addr) {
  return get(`/address/${addr}?details=txs`);
}


export async function getUtxos(addr) {
  return get(`/utxo/${addr}`);
}

// v1: returns {result: "<PRL per kB>"} — 0.00517735 observed Sep 2026
export async function getEstimateFee(blocks = 2) {
  const r = await fetch(base().replace("/v2", "/v1") + `/estimatefee/${blocks}`);
  if (!r.ok) throw new Error(`estimatefee: HTTP ${r.status}`);
  const j = await r.json();
  return parseFloat(j.result);
}

export async function broadcastTx(hex) {
  return post("/sendtx", hex);
}

export async function getBlockHeight() {
  const r = await get("/block-index/1"); // last block
  return { hash: r.blocks?.[0]?.hash ?? r.blockHash ?? null };
}

// Balance in atomals (bigint). 1 PRL = 1e8 atomals (matches btcd lineage int64 values).
export async function fetchWalletData(addr) {
  const [info, utxos] = await Promise.all([getAddressInfo(addr), getUtxos(addr)]);
  const confirmed = BigInt(info.balanceSat || info.balance || "0");
  const pending = BigInt(info.unconfirmedBalanceSat || info.unconfirmedBalance || "0");
  const txs = (info.transactions || []).slice(0, 20).map((t) => ({
    txid: t.txid,
    confirmations: t.confirmations,
    blockTime: t.blockTime,
    amount: t.value || (t.vout[0]?.value ?? 0),
    direction: t.vin ? (t.vin.some((i) => i.isAddress?.includes?.(addr)) ? "out" : "in") : "in",
  }));
  return { address: addr, confirmed, pending, utxos, txs };
}
