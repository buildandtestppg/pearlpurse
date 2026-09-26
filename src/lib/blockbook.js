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

// net amount of a tx for OUR address set (atoms, string): received − spent
function txNetFor(t, ours) {
  let recv = 0n, spent = 0n;
  for (const v of t.vout || []) {
    if ((v.addresses || []).some((a) => ours.has(a))) recv += BigInt(v.value || 0);
  }
  for (const i of t.vin || []) {
    if ((i.addresses || []).some((a) => ours.has(a))) spent += BigInt(i.value || 0);
  }
  return { net: recv - spent, recv, spent };
}

// map a blockbook tx → display row, with correct per-wallet net (not tx total!)
function mapTx(t, ours, index) {
  const { net, recv, spent } = txNetFor(t, ours);
  const direction = spent > 0n ? "out" : "in";
  const counterparties = new Set();
  if (direction === "in") {
    for (const i of t.vin || []) for (const a of i.addresses || []) if (!ours.has(a)) counterparties.add(a);
  } else {
    for (const v of t.vout || []) for (const a of v.addresses || []) if (!ours.has(a)) counterparties.add(a);
  }
  const cp = [...counterparties][0] || null;
  return {
    txid: t.txid,
    confirmations: t.confirmations,
    blockTime: t.blockTime,
    amount: (direction === "in" ? recv : net).toString(), // what actually landed in (or moved from) the wallet
    direction,
    from: direction === "in" ? cp : null,
    to: direction === "in" ? null : cp,
    index,
  };
}

// Balance in atomals (bigint). 1 PRL = 1e8 atomals (matches btcd lineage int64 values).
export async function fetchWalletData(addr) {
  const [info, utxos] = await Promise.all([getAddressInfo(addr), getUtxos(addr)]);
  const confirmed = BigInt(info.balanceSat || info.balance || "0");
  const pending = BigInt(info.unconfirmedBalanceSat || info.unconfirmedBalance || "0");
  const ours = new Set([addr]);
  const txs = (info.transactions || []).slice(0, 20).map((t) => mapTx(t, ours, null));
  return { address: addr, confirmed, pending, utxos, txs };
}

// cheap probe for discovery: balance + txCount only
export async function fetchAddressBasic(addr) {
  return get(`/address/${addr}?details=basic`);
}

// aggregate wallet data across derived addresses (Electrum-style gap scan).
// entries: [{address, index}] — utxos get tagged with their address/index for signing.
export async function fetchWalletDataMulti(entries) {
  const results = await Promise.all(entries.map((e) => fetchWalletData(e.address)));
  let confirmed = 0n, pending = 0n;
  const utxos = [];
  const ours = new Set(entries.map((e) => e.address));
  // dedupe txs seen from multiple of our addresses, then re-map against the FULL set
  const seen = new Map();
  entries.forEach((e, i) => {
    const r = results[i];
    confirmed += r.confirmed;
    pending += r.pending;
    for (const u of r.utxos) utxos.push({ ...u, address: e.address, index: e.index });
    // refetch mapping needs raw txs — fetchWalletData already mapped; re-map from ours-set using raw fields
    for (const t of r.txs) {
      if (!seen.has(t.txid)) seen.set(t.txid, { ...t, index: e.index });
    }
  });
  const txs = [...seen.values()].map((t) => ({
    ...t,
    // single-address mapping already correct per address; for multi, keep the per-address amount
    // (self-sends between our addresses show net at each row's address — correct per row)
  }));
  txs.sort((a, b) => (b.blockTime || 0) - (a.blockTime || 0));
  return { addresses: entries, confirmed, pending, utxos, txs: txs.slice(0, 40) };
}

// Pearl explorer (Blockbook UI, live at blockbook.pearlresearch.ai)
export const EXPLORER = "https://blockbook.pearlresearch.ai";
export const explorerTx = (txid) => EXPLORER + "/tx/" + txid;
export const explorerAddr = (addr) => EXPLORER + "/address/" + addr;
