import React, { useEffect, useRef, useState } from "react";
import { generateMnemonic, entropyToMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english";
import { mnemonicToSeedSync, validateMnemonic } from "@scure/bip39";
import { HDKey } from "@scure/bip32";
import { schnorr } from "@noble/curves/secp256k1";
import { addressFromPriv, derivePriv, decodePearlAddress, buildTx, tweakXOnlyPub, PEARL, signMessage, verifyMessage } from "./lib/pearl.js";
import { fetchWalletData, fetchWalletDataMulti, fetchAddressBasic, broadcastTx, getEstimateFee, getFeeCurve, getNetworkStatus, explorerTx, explorerAddr } from "./lib/blockbook.js";
import { qrDataUrl } from "./lib/qr.js";
import { seal, unseal } from "./lib/vault.js";

const ATOM = 100_000_000n;

// ── address book (module store — plain localStorage, no secrets) ─────────
const BOOK_KEY = "pearlpurse.book.v1";
const book = {
  load: () => { try { return JSON.parse(localStorage.getItem(BOOK_KEY)) || []; } catch { return []; } },
  save: (l) => localStorage.setItem(BOOK_KEY, JSON.stringify(l)),
};

// ── private tx notes (device-local) ──────────────────────────────────────
const NOTE_KEY = "pearlpurse.notes.v1";
const noteStore = {
  load: () => { try { return JSON.parse(localStorage.getItem(NOTE_KEY)) || {}; } catch { return {}; } },
  save: (o) => localStorage.setItem(NOTE_KEY, JSON.stringify(o)),
};
function txNote(txid) { return noteStore.load()[txid] || ""; }
function saveTxNote(txid, text) {
  const o = noteStore.load();
  if (text) o[txid] = text.slice(0, 140); else delete o[txid];
  noteStore.save(o);
}

// ── watch-only wallets (addresses only — nothing secret to encrypt) ──────
const WATCH_KEY = "pearlpurse.watch.v1";
const watchStore = {
  load: () => { try { return JSON.parse(localStorage.getItem(WATCH_KEY)) || []; } catch { return []; } },
  save: (l) => localStorage.setItem(WATCH_KEY, JSON.stringify(l)),
};
const fmt = (a) => {
  const neg = a < 0n; const v = neg ? -a : a;
  const whole = v / ATOM, frac = (v % ATOM).toString().padStart(8, "0").replace(/0+$/, "");
  return (neg ? "-" : "") + whole.toLocaleString("en-US") + (frac ? "." + frac.slice(0, 6) : "");
};
const short = (a) => a ? a.slice(0, 10) + "…" + a.slice(-8) : "";

// ---- pearl: URI scheme v0 (pearl:pay?addr=&amount=&label=&message=) ----
export function parsePearlURI(text) {
  const t = (text || "").trim();
  const m = t.match(/pearl:(\/\/)?pay\?[^\s]*/i); // direct launch OR http path fallback
  if (!m) return null;
  try {
    const q = new URLSearchParams(m[0].split("?")[1]);
    const addr = (q.get("addr") || q.get("address") || "").trim().toLowerCase(); // BIP-173 uppercase form
    if (!addr) return null;
    const d = decodePearlAddress(addr); // must be a valid prl taproot address
    if (!d || d.version !== 1 || d.program?.length !== 32) return null;
    const rawAmount = q.get("amount") || "";
    const amount = /^\d+(\.\d{1,8})?$/.test(rawAmount) ? rawAmount : ""; // bad amount keeps the addr
    const cap = (s) => (s || "").slice(0, 200);
    return { addr, amount, label: cap(q.get("label")), message: cap(q.get("message")) };
  } catch { return null; }
}

// Electrum-style gap-limit discovery: parallel probes until 20 consecutive unused
const GAP = 20;
async function discoverWallet(root) {
  const { fetchAddressBasic } = await import("./lib/blockbook.js");
  let highestUsed = -1;
  let scanned = 0;
  while (true) {
    const batch = [];
    for (let i = scanned; i < scanned + 10; i++) {
      const priv = derivePriv(root, i);
      batch.push({ i, address: addressFromPriv(priv) });
    }
    const rs = await Promise.all(batch.map((b) => fetchAddressBasic(b.address).catch(() => null)));
    for (let k = 0; k < rs.length; k++) {
      const r = rs[k];
      if (r && (Number(r.txCount || 0) > 0 || BigInt(r.balanceSat || 0) > 0n)) highestUsed = Math.max(highestUsed, batch[k].i);
    }
    scanned += 10;
    if (scanned - 1 - highestUsed >= GAP) break;        // gap of unused satisfied
    if (highestUsed === -1 && scanned >= 30) break;      // fresh wallet short-circuit
    if (scanned >= 200) break;                           // safety cap
  }
  const currentIdx = highestUsed + 1;
  const current = addressFromPriv(derivePriv(root, currentIdx));
  return { highestUsed, current, currentIdx };
}

// ---------- storage (encrypted-at-rest: seed XOR'd with device key is v2; plaintext local for v1) ----------
const LS_KEY = "pearlpurse.v1";
const store = {
  load: () => { try { return JSON.parse(localStorage.getItem(LS_KEY)); } catch { return null; } },
  save: (d) => localStorage.setItem(LS_KEY, JSON.stringify(d)),
  clear: () => localStorage.removeItem(LS_KEY),
};

export default function App() {
  const [wallet, setWallet] = useState(null); // {mnemonic, address, index}
  const [locked, setLocked] = useState(false);
  const [unlockPw, setUnlockPw] = useState("");
  const [unlockErr, setUnlockErr] = useState("");
  const [unlockBusy, setUnlockBusy] = useState(false);
  const [lastActive, setLastActive] = useState(Date.now());
  const [pendingURI, setPendingURI] = useState(null); // pearl: pay request captured pre-unlock
  const [data, setData] = useState(null);
  const [sheet, setSheet] = useState(null);
  const [detailTx, setDetailTx] = useState(null); // 'create' | 'import' | 'send' | 'receive' | 'settings'
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [watching, setWatching] = useState(null); // { label, address } — read-only view
  const [contacts, setContacts] = useState(book.load());
  const [watchData, setWatchData] = useState(null);
  // watch-only: fetch + refresh on pearlpurse:refresh events
  useEffect(() => {
    if (!watching) { setWatchData(null); return; }
    let dead = false;
    const pull = async () => {
      try { const d = await fetchAddressBasic(watching.address); if (!dead) setWatchData(d); }
      catch { if (!dead) setWatchData({ error: "fetch failed" }); }
    };
    pull();
    window.addEventListener("pearlpurse:refresh", pull);
    return () => { dead = true; window.removeEventListener("pearlpurse:refresh", pull); };
  }, [watching]);

  useEffect(() => {
    const w = store.load();
    if (!w) return;
    if (w.vault) setLocked(true);
    else setWallet(w); // legacy plaintext (dev only) — wiped on next save
  }, []);

  // pearl: URI → pre-fill Send. Capture ONLY real protocol launches or an exact /pearl:pay
  // path — never a substring (blocks ?x=pearl:pay?... drive-by invoice phishing on our domain).
  const consumedURI = useRef(false);
  const openPayRequest = (uriText) => {
    const r = parsePearlURI(uriText);
    if (r) { consumedURI.current = false; setPendingURI(r); }
  };
  useEffect(() => {
    let uri = null;
    if (location.protocol === "pearl:") uri = location.href;
    else if (location.pathname.startsWith("/pearl:")) uri = location.pathname + location.search;
    else { const u = new URLSearchParams(location.search).get("uri") || ""; if (u.toLowerCase().startsWith("web+pearl:")) uri = u.replace(/^web\+/i, ""); }
    if (uri) {
      openPayRequest(uri);
      history.replaceState(null, "", "/"); // never re-capture on reload
    }
  }, []);
  // when unlocked with a pending request → open Send pre-filled, exactly once per URI
  useEffect(() => { if (wallet && pendingURI && !consumedURI.current) { consumedURI.current = true; setSheet("send"); } }, [wallet, pendingURI]);
  // any manual sheet navigation disarms a pending URI (no resurrection later)
  const openSheet = (name) => { if (name !== "send") setPendingURI(null); setSheet(name); };

  // one-time migration: pre-rotation wallets (no highestUsed) get gap-20 discovery on first unlock
  useEffect(() => {
    if (!wallet || wallet.highestUsed !== undefined) return;
    (async () => {
      try {
        const root = HDKey.fromMasterSeed(mnemonicToSeedSync(wallet.mnemonic));
        const s = await discoverWallet(root);
        const saved = store.load();
        store.save({ ...saved, highestUsed: s.highestUsed, address: s.current, index: s.currentIdx, ts: Date.now() });
        setWallet((w) => ({ ...w, highestUsed: s.highestUsed, address: s.current, index: s.currentIdx }));
      } catch { /* offline: retry next unlock */ }
    })();
  }, [wallet?.mnemonic]);

  // auto-lock after 5 min idle
  useEffect(() => {
    if (!wallet) return;
    const bump = () => setLastActive(Date.now());
    window.addEventListener("pointerdown", bump);
    const t = setInterval(() => { if (Date.now() - lastActive > 5 * 60_000) { setWallet(null); setLocked(true); } }, 15_000);
    return () => { window.removeEventListener("pointerdown", bump); clearInterval(t); };
  }, [wallet, lastActive]);
  // full scan: current + trailing GAP window (rotation-aware refresh)
  useEffect(() => {
    if (!wallet) return;
    let live = true;
    const load = async () => {
      try {
        const root = HDKey.fromMasterSeed(mnemonicToSeedSync(wallet.mnemonic));
        // runtime watch set = USED addresses + current receive ONLY
        // (gap-20 lookahead runs once at import; watching 30 addrs every 30s was overkill)
        const usedUpTo = wallet.highestUsed ?? -1;
        const indices = [];
        for (let i = 0; i <= usedUpTo; i++) indices.push(i);
        if (!indices.includes(wallet.index)) indices.push(wallet.index);
        const entries = indices.map((i) => ({ address: addressFromPriv(derivePriv(root, i)), index: i }));
        const d = await fetchWalletDataMulti(entries);
        if (live) { setData(d); setError(""); }
      } catch (e) { if (live) setError(e.message); }
    };
    load();
    const t = setInterval(load, 30000);
    const onRefresh = () => load();
    window.addEventListener("pearlpurse:refresh", onRefresh);
    return () => { live = false; clearInterval(t); window.removeEventListener("pearlpurse:refresh", onRefresh); };
  }, [wallet]);

  // advance rotation when the current receive address receives funds
  useEffect(() => {
    if (!wallet || !data) return;
    const currentIdx = wallet.index;
    const cur = data.addresses?.find((a) => a.index === currentIdx);
    const curUsed = data.txs?.some((t) => t.index === currentIdx);
    if (curUsed && currentIdx === wallet.highestUsed + 1) {
      const next = currentIdx + 1;
      const root = HDKey.fromMasterSeed(mnemonicToSeedSync(wallet.mnemonic));
      const nextAddress = addressFromPriv(derivePriv(root, next));
      const saved = store.load();
      store.save({ ...saved, highestUsed: currentIdx, address: nextAddress, index: next, ts: Date.now() });
      setWallet({ ...wallet, highestUsed: currentIdx, address: nextAddress, index: next });
    }
  }, [data]);

  const notify = (m) => { setToast(m); setTimeout(() => setToast(""), 2600); };

  // manual rotation: advance to next unused receive address
  const rotateNow = () => {
    if (!wallet) return;
    const next = wallet.index + 1;
    const root = HDKey.fromMasterSeed(mnemonicToSeedSync(wallet.mnemonic));
    const nextAddress = addressFromPriv(derivePriv(root, next));
    const saved = store.load();
    store.save({ ...saved, address: nextAddress, index: next, ts: Date.now() });
    setWallet({ ...wallet, address: nextAddress, index: next });
    notify("New receive address — index " + next);
  };

  const doUnlock = async () => {
    setUnlockBusy(true); setUnlockErr("");
    try {
      const saved = store.load();
      const m = await unseal(saved.vault, unlockPw);
      setWallet({ mnemonic: m, address: saved.address, index: saved.index ?? 0, highestUsed: saved.highestUsed ?? saved.index - 1 ?? -1 });
      setLocked(false); setUnlockPw(""); setLastActive(Date.now());
    } catch {
      setUnlockErr("Wrong password (or corrupted vault)");
    } finally { setUnlockBusy(false); }
  };

  if (locked) {
    return (
      <div className="app">
        <div className="welcome">
          <img className="logo-big" src="/pearl.svg" alt="" />
          <h1>🔒 PearlPurse</h1>
          <p>Enter your password to unlock.</p>
          <div className="field">
            <input className="input" type="password" value={unlockPw} onChange={(e) => setUnlockPw(e.target.value)}
              placeholder="Password" onKeyDown={(e) => e.key === "Enter" && doUnlock()} />
          </div>
          {unlockErr && <div className="err">{unlockErr}</div>}
          <button className="btn primary" disabled={unlockBusy} onClick={doUnlock}>{unlockBusy ? "Decrypting…" : "Unlock"}</button>
          <button className="btn ghost" onClick={() => { if (confirm("Wipe vault? You'll need the 12-word seed to restore.")) { store.clear(); location.reload(); } }}>Forgot password</button>
        </div>
      </div>
    );
  }

  if (!wallet) {
    if (watching) {
      return (
        <div className="app">
          <div style={{ textAlign: "center", margin: "10px 0 16px" }}>
            <img src="/pearl.svg" alt="" style={{ width: 40, opacity: 0.9 }} />
            <div className="small" style={{ color: "var(--muted)", marginTop: 6 }}>PearlPurse · watch-only mode</div>
          </div>
          <WatchPanel watching={watching} watchData={watchData} setWatching={setWatching} short={short} fmt={fmt} />
          <button className="btn ghost small" style={{ width: "100%", marginTop: 4 }} onClick={() => setWatching(null)}>← Back</button>
        </div>
      );
    }
    return (
      <Welcome
        onWatch={() => setWatching(watchStore.load()[watchStore.load().length - 1] || null)}
        onCreate={async (m, pw) => {
          const seed = mnemonicToSeedSync(m);
          const root = HDKey.fromMasterSeed(seed);
          const priv = derivePriv(root, 0);
          const address = addressFromPriv(priv);
          store.save({ vault: await seal(m, pw), highestUsed: -1, address, index: 0, ts: Date.now() });
          setWallet({ mnemonic: m, address, index: 0, highestUsed: -1 });
        }}
      />
    );
  }

  return (
    <div className="app">
      <div className="topbar">
        <div className="brand">
          <img src="/pearl.svg" alt="" />
          <div>
            <div className="name">PearlPurse</div>
            <div className="tag">mainnet · bip86 taproot</div>
          </div>
        </div>
        <div className="net-pill">{data ? "SYNCED" : busy ? "…" : "OFFLINE"}</div>
      </div>

      <div className="hero">
        <div className="label">Available balance</div>
        <div className="balance">
          {data ? fmt(data.confirmed) : "—"}<span className="cur">PRL</span>
        </div>
        {data && data.pending !== 0n && <div className="pending">{fmt(data.pending)} PRL pending</div>}
      </div>

      <div className="actions">
        <button className="btn" onClick={() => openSheet("receive")}>⬇ Receive</button>
        <button className="btn primary" onClick={() => openSheet("send")}>⬆ Send</button>
      </div>
      <div style={{ textAlign: "center", margin: "-8px 0 10px" }}>
        <button className="btn ghost small" onClick={() => openSheet("getprl")}>＋ Get PRL — how to fund this wallet</button>
      </div>

      {error && <div className="err">{error}</div>}

      {watching && <WatchPanel watching={watching} watchData={watchData} setWatching={setWatching} short={short} fmt={fmt} />}
      <div className="section-label">Activity</div>
      <div className="card">
        {!data || data.txs.length === 0 ? (
          <div className="center small" style={{ padding: "14px 0" }}>No transactions yet</div>
        ) : (
          <div className="txlist">
            {data.txs.map((t) => (
              <div className="tx clickable" key={t.txid} onClick={() => setDetailTx(t)}>
                <div className={"dir " + t.direction}>{t.direction === "in" ? "↘" : "↗"}</div>
                <div className="mid">
                  <div className="addr mono">{t.direction === "in" ? short(t.from || "coinbase") : short(t.to || t.txid)}</div>
                  <div className="sub">{t.confirmations > 0 ? `${t.confirmations.toLocaleString()} confs` : "pending"} · {new Date((t.blockTime || 0) * 1000).toLocaleDateString()}{txNote(t.txid) ? " · 📝 " + txNote(t.txid) : ""}</div>
                </div>
                <div className={"amt " + t.direction}>{t.direction === "in" ? "+" : "−"}{fmt(BigInt(t.amount || "0"))}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="section-label">Account</div>
      <div className="card">
        <div className="kv"><span className="k">Address</span><span className="mono" style={{ fontSize: 11 }}>{short(wallet.address)}</span></div>
        <div className="kv"><span className="k">Derivation</span><span className="mono" style={{ fontSize: 11 }}>m/86'/808276'/0'/0/{wallet.index}</span></div>
        <div className="kv"><span className="k">Addresses</span><span>{data ? data.addresses.length : "—"} · rotate ↻</span></div>
        <div className="kv"><span className="k">UTXOs</span><span>{data ? data.utxos.length : "—"}</span></div>
        <button className="btn ghost small" style={{ width: "100%", marginTop: 8 }} onClick={rotateNow}>↻ New receive address</button>
      </div>

      <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
        <button className="btn ghost small" style={{ flex: 1 }} onClick={() => setSheet("receive")}>Receive</button>
        <button className="btn ghost small" style={{ flex: 1 }} onClick={() => openSheet("sign")}>✍️ Sign</button>
        <button className="btn ghost small" style={{ flex: 1 }} onClick={() => openSheet("verify")}>🔍 Verify</button>
      </div>
      <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
        <button className="btn ghost small" style={{ flex: 1 }} onClick={() => setSheet("book")}>📒 Address book ({contacts.length})</button>
        <button className="btn ghost small" style={{ flex: 1 }} onClick={() => setSheet("proof")}>🛡 Proof of funds</button>
      </div>
      <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
        <button className="btn ghost small" style={{ flex: 1 }} onClick={() => { if (confirm("Wipe wallet from this device? You'll need your seed phrase to recover.")) { store.clear(); setWallet(null); setData(null); } }}>Wipe device</button>
      </div>
      {(watchStore.load().length > 0 || watching) && (
        <>
          <div className="section-label" style={{ marginTop: 16 }}>Watching</div>
          <div className="card">
            {watchStore.load().map((w) => (
              <div className="tx clickable" key={w.address} onClick={() => setWatching(watching?.address === w.address ? null : w)} style={{ opacity: watching?.address === w.address ? 1 : 0.75 }}>
                <div className="dir">👁</div>
                <div className="mid">
                  <div className="addr">{w.label}</div>
                  <div className="sub mono">{short(w.address)}</div>
                </div>
                <div className="amt">{watching?.address === w.address ? "▲" : "▼"}</div>
              </div>
            ))}
            <button className="btn ghost small" style={{ width: "100%", marginTop: 8 }} onClick={() => setSheet("watchadd")}>＋ Watch another address</button>
          </div>
        </>
      )}

      {sheet === "proof" && <ProofSheet wallet={wallet} data={data} onClose={() => setSheet(null)} notify={notify} />}
      {sheet === "watchadd" && <WatchAddSheet onAdded={(w) => { setSheet(null); setWatching(w); }} onClose={() => setSheet(null)} />}
      {sheet === "book" && <BookSheet contacts={contacts} onChange={setContacts} onSend={(addr, label) => { setPendingURI({ addr, label }); setSheet("send"); }} onClose={() => setSheet(null)} />}
      {sheet === "receive" && <ReceiveSheet address={wallet.address} onClose={() => setSheet(null)} notify={notify} />}
      {sheet === "sign" && <SignSheet wallet={wallet} onClose={() => setSheet(null)} notify={notify} />}
      {sheet === "verify" && <VerifySheet onClose={() => setSheet(null)} />}
      {sheet === "getprl" && <GetPrlSheet address={wallet.address} onCopied={notify} onClose={() => setSheet(null)} />}
      {detailTx && (
        <TxDetailSheet
          tx={detailTx}
          onClose={() => setDetailTx(null)}
          ourAddrs={new Set((data?.addresses || []).map((a) => a.address))}
        />
      )}
      {sheet === "send" && (
        <SendSheet
          onReceive={() => { setSheet("receive"); setPendingURI(null); }}
          prefill={pendingURI}
          wallet={wallet}
          utxos={data?.utxos || []}
          balance={data?.confirmed || 0n}
          onClose={() => { setSheet(null); setPendingURI(null); }}
          onSent={async (hex) => {
            const r = await broadcastTx(hex);
            notify("Broadcast — " + (r.result || "submitted"));
            setSheet(null);
            setTimeout(() => window.dispatchEvent(new Event("pearlpurse:refresh")), 100);
          }}
        />
      )}

      {toast && (
        <div style={{ position: "fixed", bottom: 26, left: "50%", transform: "translateX(-50%)", background: "var(--green)", color: "#1c231f", fontWeight: 700, fontSize: 13, padding: "10px 18px", borderRadius: 99, zIndex: 99 }}>
          {toast}
        </div>
      )}
    </div>
  );
}


function WatchPanel({ watching, watchData, setWatching, short, fmt }) {
  const safeAmt = (v) => { try { return fmt(BigInt(String(v ?? "0"))); } catch { return "—"; } };
  const nTxs = watchData && !watchData.error ? (watchData.txs ?? watchData.txCount ?? "—") : "—";
  return (
    <div className="card" style={{ marginBottom: 14 }}>
      <div className="kv"><span className="k">👁 {watching.label}</span><span className="mono" style={{ fontSize: 11 }}>{short(watching.address)}</span></div>
      <div className="kv"><span className="k">Balance</span><span className="amt" style={{ fontWeight: 700 }}>{watchData && !watchData.error ? safeAmt(watchData.balance) + " PRL" : "…"}</span></div>
      <div className="kv"><span className="k">Received</span><span>{watchData && !watchData.error && watchData.totalReceived != null ? safeAmt(watchData.totalReceived) + " PRL" : "—"}</span></div>
      <div className="kv"><span className="k">Txs</span><span>{nTxs}</span></div>
      <div className="kv"><span className="k">Mode</span><span style={{ color: "var(--muted)" }}>read-only · no keys on this device</span></div>
      <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
        <a className="btn ghost small" style={{ flex: 1, textDecoration: "none", textAlign: "center" }} href={explorerAddr(watching.address)} target="_blank" rel="noreferrer">Explorer ↗</a>
        <button className="btn ghost small" style={{ flex: 1 }} onClick={() => { if (confirm("Remove watch address?")) { const l = watchStore.load().filter((w) => w.address !== watching.address); watchStore.save(l); setWatching(null); } }}>Remove</button>
      </div>
      {watchData?.error && <div className="err" style={{ marginTop: 8 }}>{watchData.error}</div>}
    </div>
  );
}

function Welcome({ onCreate, onImport, onWatch }) {
  const [mode, setMode] = useState(null);
  const [mnemonic, setMnemonic] = useState("");
  const [err, setErr] = useState("");
  const [created, setCreated] = useState("");
  const [copied, setCopied] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false);
  const pwOk = pw.length >= 8 && pw === pw2;
  const [watchAddr, setWatchAddr] = useState("");
  const [watchLabel, setWatchLabel] = useState("");

  return (
    <div className="app">
      <div className="welcome">
        <img className="logo-big" src="/pearl.svg" alt="" />
        <h1>PearlPurse</h1>
        <p>A non-custodial wallet for Pearl.<br />Keys live on this device only.</p>

        {mode === "import" ? (
          <>
            <div className="field">
              <label>Seed phrase (12/24 words)</label>
              <textarea className="input mono" rows={3} value={mnemonic} onChange={(e) => setMnemonic(e.target.value)} placeholder="word word word …" />
            </div>
            {err && <div className="err">{err}</div>}
            <div className="field"><label>Encryption password (min 8)</label>
              <input className="input" type="password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="••••••••" autoComplete="new-password" /></div>
            {pw.length > 0 && pw !== pw2 && <div className="small" style={{ color: "#e5958f" }}>Passwords do not match</div>}
            <div className="field"><label>Confirm password</label>
              <input className="input" type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} placeholder="••••••••" autoComplete="new-password" /></div>
            <button className="btn primary" disabled={!pwOk || busy} onClick={async () => {
              setBusy(true); setErr("");
              try { await onImport(mnemonic.trim(), pw); } catch (e) { setErr(e.message); setBusy(false); }
            }}>{busy ? "Importing…" : "Import wallet"}</button>
            <button className="btn ghost" onClick={() => setMode(null)}>Back</button>
          </>
        ) : mode === "watch" ? (
          <>
            <div className="field">
              <label>Pearl address (prl1…)</label>
              <input className="input mono" value={watchAddr} onChange={(e) => setWatchAddr(e.target.value.trim())} placeholder="prl1p…" />
            </div>
            <div className="field">
              <label>Label (optional)</label>
              <input className="input" value={watchLabel} onChange={(e) => setWatchLabel(e.target.value)} placeholder="e.g. cold vault, friend" />
            </div>
            {err && <div className="err">{err}</div>}
            <button className="btn primary" disabled={busy} onClick={async () => {
              setBusy(true); setErr("");
              try {
                const a = watchAddr.toLowerCase();
                const d = decodePearlAddress(a);
                if (!d || d.version !== 1 || d.program?.length !== 32) throw new Error("Not a valid prl1… taproot address");
                const l = watchStore.load();
                if (l.some((w) => w.address === a)) throw new Error("Already watching this address");
                l.push({ label: watchLabel.trim() || "watch " + (l.length + 1), address: a, added: Date.now() });
                watchStore.save(l);
                onWatch();
              } catch (e) { setErr(e.message || "Address not found on-chain"); }
              setBusy(false);
            }}>{busy ? "Checking…" : "Watch address"}</button>
            <button className="btn ghost" onClick={() => setMode(null)}>Back</button>
          </>
        ) : mode === "create" ? (
          <>
            <div className="warn">⚠️ Write these 12 words on paper. No screenshots, no cloud. If you lose them, your PRL is gone forever.</div>
            <div className="seed-box">{created}</div>
            <button className="btn" onClick={() => { navigator.clipboard.writeText(created); setCopied(true); }}>{copied ? "Copied ✓" : "Copy words"}</button>
            <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13, margin: "10px 2px" }}>
              <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
              I've saved my seed phrase somewhere safe
            </label>
            {confirmed && (
              <>
                <div className="field"><label>Encryption password (min 8)</label>
                  <input className="input" type="password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="••••••••" autoComplete="new-password" /></div>
                {pw.length > 0 && pw !== pw2 && <div className="small" style={{ color: "#e5958f" }}>Passwords do not match</div>}
                {pw.length > 0 && pw.length < 8 && <div className="small" style={{ color: "#e5958f" }}>Minimum 8 characters</div>}
                <div className="field"><label>Confirm password</label>
                  <input className="input" type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} placeholder="••••••••" autoComplete="new-password" /></div>
              </>
            )}
            <button className="btn primary" disabled={!confirmed || !pwOk || busy} onClick={async () => {
              setBusy(true); setErr("");
              try { await onCreate(created, pw); } catch (e) { setErr(e.message); setBusy(false); }
            }}>{busy ? "Encrypting…" : "Open wallet"}</button>
          </>
        ) : (
          <>
            {watchStore.load().length > 0 && (
              <button className="btn ghost" onClick={onWatch}>👁 Resume watching ({watchStore.load().length})</button>
            )}
            <button className="btn primary" onClick={() => { const m = entropyToMnemonic(crypto.getRandomValues(new Uint8Array(16)), wordlist); setCreated(m); setMode("create"); }}>Create new wallet</button>
            <button className="btn" onClick={() => setMode("import")}>Import seed phrase</button>
            <button className="btn ghost" onClick={() => setMode("watch")}>👁 Watch an address (read-only)</button>
          </>
        )}
      </div>
    </div>
  );
}

function ReceiveSheet({ address, onClose, notify }) {
  const [qr, setQr] = useState("");
  useEffect(() => { try { setQr(qrDataUrl("pearl:" + address, 7)); } catch (e) { setQr(""); } }, [address]);
  return (
    <Sheet title="Receive PRL" sub="Share your address — bech32m taproot" onClose={onClose}>
      <div className="qr-wrap">{qr ? <img className="qr-card" src={qr} alt="address QR" width={190} height={190} /> : <div className="small">generating…</div>}</div>
      <div className="copyline">
        <input className="input mono" readOnly value={address} />
        <button className="btn small" onClick={() => { navigator.clipboard.writeText(address); notify("Address copied"); }}>Copy</button>
      </div>
      <div className="small mt8">Senders on exchanges must support bech32m (taproot) withdrawals.</div>
    </Sheet>
  );
}

function TxDetailSheet({ tx, onClose, ourAddrs }) {
  const isOurs = (a) => ourAddrs.has(a);
  return (
    <Sheet title="Transaction" onClose={onClose}>
      <div className="card" style={{ display: "grid", gap: 10 }}>
        <div className="kv"><span className="k">Direction</span><span>{tx.direction === "in" ? "↘ Received" : "↗ Sent"}</span></div>
        <div className="kv"><span className="k">Amount</span><span className={"amt " + tx.direction}>{tx.direction === "in" ? "+" : "−"}{fmt(BigInt(tx.amount || "0"))} PRL</span></div>
        <div className="kv"><span className="k">Date</span><span>{new Date((tx.blockTime || 0) * 1000).toLocaleString()}</span></div>
        <div className="kv"><span className="k">Confirmations</span><span>{tx.confirmations > 0 ? tx.confirmations.toLocaleString() : "0 (in mempool)"}</span></div>
        {tx.fee != null && <div className="kv"><span className="k">Fee</span><span className="mono">{fmt(BigInt(tx.fee || "0"))} PRL</span></div>}
        <div className="section-label" style={{ marginTop: 6 }}>Inputs</div>
        {(tx.vins || []).map((vin, k) => (
          <div key={k} className={"mono" + (isOurs(vin.addresses[0]) ? " ours" : "")} style={{ fontSize: 11, opacity: isOurs(vin.addresses[0]) ? 1 : 0.6, wordBreak: "break-all" }}>
            {vin.addresses[0] ? (isOurs(vin.addresses[0]) ? "● " : "") + short(vin.addresses[0]) : "coinbase"}{vin.value ? " · " + fmt(BigInt(vin.value)) : ""}
          </div>
        ))}
        <div className="section-label" style={{ marginTop: 6 }}>Outputs</div>
        {(tx.vouts || []).map((vout, k) => (
          <div key={k} className={"mono" + (isOurs(vout.addresses[0]) ? " ours" : "")} style={{ fontSize: 11, opacity: isOurs(vout.addresses[0]) ? 1 : 0.6, wordBreak: "break-all" }}>
            {vout.addresses[0] ? (isOurs(vout.addresses[0]) ? "● " : "") + short(vout.addresses[0]) : "???"} · {fmt(BigInt(vout.value || "0"))}
          </div>
        ))}
        <div className="section-label" style={{ marginTop: 6 }}>Txid</div>
        <div className="mono" style={{ fontSize: 11, wordBreak: "break-all" }}>{tx.txid}</div>
        <div className="field" style={{ marginTop: 10 }}>
          <label>Note (private, stored on this device)</label>
          <input className="input" defaultValue={txNote(tx.txid)} onBlur={(e) => saveTxNote(tx.txid, e.target.value.trim())} placeholder="e.g. paid Alice for design work" />
        </div>
        <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
          <button className="btn ghost small" style={{ flex: 1 }} onClick={() => navigator.clipboard?.writeText(tx.txid).then(() => alert("Txid copied"))}>Copy txid</button>
          <a className="btn ghost small" style={{ flex: 1, textDecoration: "none", textAlign: "center" }} href={explorerTx(tx.txid)} target="_blank" rel="noreferrer">Explorer ↗</a>
        </div>
      </div>
    </Sheet>
  );
}

function SendSheet({ wallet, utxos, balance, onClose, onSent, onReceive, prefill }) {
  const [to, setTo] = useState(prefill?.addr || "");
  const uriNotes = [prefill?.label, prefill?.message].filter(Boolean);
  const [amount, setAmount] = useState(prefill?.amount || "");
  const [feeRate, setFeeRate] = useState(null);
  const [feeMode, setFeeMode] = useState("std"); // slow 0.8x · std 1x · fast 1.5x
  const [maxActive, setMaxActive] = useState(false); // MAX = live mode, recomputed on fee/balance change
  const [stage, setStage] = useState("form"); // form | review | sending | sent
  const [hex, setHex] = useState(null);
  const [err, setErr] = useState("");
  const [txid, setTxid] = useState("");

  const [curve, setCurve] = useState(null);   // {fast, std, slow} — real per-block-target rates
  const [net, setNet] = useState(null);        // {height, mempool, inSync}
  useEffect(() => {
    getEstimateFee(2).then(setFeeRate).catch(() => setFeeRate(0.0052));
    getFeeCurve().then(setCurve).catch(() => {});   // fallback to multipliers if unavailable
    getNetworkStatus().then(setNet).catch(() => {});
  }, []);

  const amtAtoms = (() => {
    if (!amount) return 0n;
    const m = /^\d+(?:\.(\d{1,8}))?$/.exec(amount.trim());
    if (!m) return 0n;
    const frac = (m[1] ?? "").padEnd(8, "0");
    return BigInt(amount.trim().split(".")[0] + frac);
  })();

  // fee: taproot vBytes — witness bytes count 1/4 (segwit discount).
  // 1-in/2-out ≈ 141 vB, 1-in/1-out ≈ 110 vB; +8% safety margin.
  const vbytes = 2 * 31 + 10 + 12 + 68 + Math.ceil(66 / 4); // outputs+overhead+input+witness
  const FEE_MULT = { slow: 0.8, std: 1, fast: 1.5 }; // fallback only, when the curve endpoint is down
  const BLOCK_TARGET = { fast: 1, std: 2, slow: 5 };
  const effRate = curve ? curve[feeMode] : (feeRate ? feeRate * FEE_MULT[feeMode] : null);
  const feeForModeRate = (m) => (curve ? curve[m] : (feeRate ? feeRate * FEE_MULT[m] : null));
  const rateAtoms = effRate ? BigInt(Math.round(effRate * 1e8)) : 0n; // atoms per kB
  const feeFor = (vb) => rateAtoms * BigInt(vb) / 1000n + (rateAtoms * BigInt(vb) % 1000n > 0n ? 1n : 0n) + 1400n; // ceil + dust-buffer
  const feeAtomsForRate = (rate) => { const ra = BigInt(Math.round(rate * 1e8)); return ra * BigInt(vbytes) / 1000n + (ra * BigInt(vbytes) % 1000n > 0n ? 1n : 0n) + 1400n; };
  const [feeAtoms, setFeeAtoms] = useState(0n);
  useEffect(() => { if (effRate) setFeeAtoms(feeFor(vbytes)); }, [effRate, feeMode, curve]);
  // MAX is a live mode: amount tracks balance − the fee build() actually charges − 546-atom change floor,
  // recomputed when the estimate lands or the fee mode changes. Editing the amount exits the mode.
  useEffect(() => {
    if (!maxActive || !effRate) return;
    const maxSend = balance - feeFor(vbytes) - 546n;
    setAmount(maxSend > 0n ? (Number(maxSend) / 1e8).toFixed(8) : "");
  }, [maxActive, effRate, feeMode, balance]);

  const build = () => {
    const d = decodePearlAddress(to.trim());
    if (!d || d.version !== 1 || d.program?.length !== 32) throw new Error("Not a valid prl1… taproot address");
    if (amtAtoms <= 0n) throw new Error("Enter an amount");
    if (!effRate || feeAtoms <= 0n) throw new Error("Fee not estimated yet — try again in a moment");
    if (amtAtoms < 546n) throw new Error("Below network dust limit (min sendable: 0.00000546 PRL)");
    if (feeAtoms >= balance) throw new Error(`Balance too low: network fee is ~${fmt(feeAtoms)} PRL but balance is ${fmt(balance)} PRL`);
    if (amtAtoms + feeAtoms > balance) throw new Error(`Amount + fee (${fmt(amtAtoms + feeAtoms)} PRL) exceeds balance (${fmt(balance)} PRL)`);
    const seed = mnemonicToSeedSync(wallet.mnemonic);
    const root = HDKey.fromMasterSeed(seed);
    const privCache = new Map();
    const keyFor = (idx) => {
      if (!privCache.has(idx)) privCache.set(idx, derivePriv(root, idx));
      return privCache.get(idx);
    };
    // pick UTXOs across ALL discovered addresses (largest-first until covered)
    const sorted = [...utxos].sort((a, b) => Number(BigInt(b.value) - BigInt(a.value)));
    const picked = [];
    let sum = 0n;
    for (const u of sorted) { picked.push(u); sum += BigInt(u.value); if (sum >= amtAtoms + feeAtoms + 546n) break; }
    if (sum < amtAtoms + feeAtoms) throw new Error("Not enough UTXOs");
    let change = sum - amtAtoms - feeAtoms;
    // sub-dust change folds into fee (bounded by 545 atoms — explicit, tiny)
    if (change > 0n && change < 546n) change = 0n;
    const inputs = picked.map((u) => ({ txid: u.txid, vout: u.vout, value: Number(BigInt(u.value)), xOnlyPub: null, priv: keyFor(u.index ?? wallet.index) }));
    const outputs = [{ xOnlyPub: d.program, value: Number(amtAtoms) }];
    if (change >= 546n) outputs.push({ xOnlyPub: tweakXOnlyPub(schnorr.getPublicKey(keyFor(wallet.index))).tweakedX, value: Number(change) });
    return buildTx(inputs, outputs);
  };

  const submit = async () => {
    setErr("");
    setStage("sending");
    try {
      const r = await onSent(hex);
    } catch (e) { setErr(e.message); setStage("review"); }
  };

  return (
    <Sheet title={stage === "sent" ? "Sent" : "Send PRL"} sub={stage === "form" ? "taproot key-path spend" : ""} onClose={onClose}>
      {stage === "sent" ? (
        <div className="success-anim">
          <div className="check">✅</div>
          <div className="mono small" style={{ wordBreak: "break-all", margin: "10px 0" }}>{txid || "submitted"}</div>
          <button className="btn primary" onClick={onClose}>Done</button>
        </div>
      ) : stage === "sending" ? (
        <div className="center" style={{ padding: "30px 0" }}><span className="spinner" /></div>
      ) : stage === "review" ? (
        <>
          <div className="card" style={{ background: "var(--card-2)" }}>
            <div className="kv"><span className="k">To</span><span className="mono" style={{ fontSize: 11 }}>{short(to)}</span></div>
            <div className="kv"><span className="k">Amount</span><span>{fmt(amtAtoms)} PRL</span></div>
            <div className="kv"><span className="k">Fee</span><span>{fmt(feeAtoms)} PRL</span></div>
            <div className="kv"><span className="k">Rate</span><span className="mono">{effRate?.toFixed(5)} PRL/kB ({feeMode})</span></div>
          </div>
          {err && <div className="err">{err}</div>}
          <div className="row2 mt16">
            <button className="btn" onClick={() => setStage("form")}>Back</button>
            <button className="btn primary" onClick={submit}>Confirm & send</button>
          </div>
        </>
      ) : feeAtoms && feeAtoms + 546n >= balance ? (
        (() => {
          const MODES = [["slow", "🐢 Slow", "~5 blocks"], ["std", "⚡ Standard", "~2 blocks"], ["fast", "🚀 Fast", "next block"]];
          const withRates = MODES.map(([m, label, tgt]) => ({ m, label, tgt, rate: feeForModeRate(m) })).filter((x) => x.rate);
          const sendable = withRates.filter((x) => balance > feeAtomsForRate(x.rate) + 546n);
          const cheapest = withRates.slice().sort((a, b) => Number(feeAtomsForRate(a.rate) - feeAtomsForRate(b.rate)))[0];
          const need = cheapest ? feeAtomsForRate(cheapest.rate) + 546n - balance : 546n;
          return (
            <div style={{ textAlign: "center", padding: "8px 0 2px" }}>
              <div style={{ fontSize: 40, marginBottom: 6 }}>{sendable.length ? "✅" : "🛑"}</div>
              <h3 style={{ marginBottom: 4 }}>{sendable.length ? "You can still send" : "You can't send yet"}</h3>
              <div className="small" style={{ marginBottom: 14 }}>
                {sendable.length
                  ? "Your balance can't cover the standard fee, but a slower confirmation fits."
                  : "Your balance can't cover the network fee on any confirmation speed. Receive PRL to this address to unlock sending."}
              </div>
              <div className="card" style={{ background: "var(--card-2)", textAlign: "left" }}>
                <div className="kv"><span className="k">Your balance</span><span>{fmt(balance)} PRL</span></div>
                {withRates.map((x) => (
                  <div className="kv" key={x.m}>
                    <span className="k">{x.label} fee <span style={{ letterSpacing: 0, textTransform: "none" }}>({x.tgt})</span></span>
                    <span>{feeAtomsForRate(x.rate) + 546n < balance ? "✅ " : ""}~{fmt(feeAtomsForRate(x.rate))} PRL</span>
                  </div>
                ))}
                {sendable.length
                  ? <div className="kv"><span className="k">Switch to</span><span>{sendable.map((x) => x.label.split(" ")[1]).join(" / ")}</span></div>
                  : <div className="kv"><span className="k">Top up to unlock</span><span>≈ {fmt(need > 0n ? need : 546n)} PRL</span></div>}
              </div>
              <div className="small" style={{ display: "flex", justifyContent: "center", gap: 4, margin: "12px 0 4px" }}>
                {withRates.map((x) => (
                  <button key={x.m} className={"btn ghost small" + (feeMode === x.m ? " on" : "")} style={{ padding: "4px 8px" }} onClick={() => setFeeMode(x.m)}>{x.label}</button>
                ))}
              </div>
              <div className="small" style={{ marginBottom: 12 }}>
                {net ? `Network: block ${net.height?.toLocaleString()} · ${net.mempool} tx in mempool · ${net.inSync ? "synced ✅" : "syncing…"}` : "Network: fetching status…"}
              </div>
              <div className="row2">
                <button className="btn" onClick={onClose}>Close</button>
                <button className="btn primary" onClick={onReceive}>⬇ Receive PRL</button>
              </div>
            </div>
          );
        })()
      ) : (
        <>
          {uriNotes.length > 0 && (
            <div className="small" style={{ background: "var(--card-2)", borderRadius: 10, padding: "8px 10px", marginBottom: 10 }}>
              Payment request{uriNotes.length > 1 ? "s" : ""}: {uriNotes.map((n, i) => <span key={i}><b>{n}</b>{i < uriNotes.length - 1 ? " · " : ""}</span>)}
            </div>
          )}
          <div className="field">
            <label>Recipient</label>
            <input className="input mono" value={to} {...(prefill?.addr ? { readOnly: true } : {})} onChange={(e) => setTo(e.target.value)} placeholder="prl1p…" />
          {prefill?.addr && <div className="small mt8">🔒 Recipient locked by payment link — verify it's who you expect before sending.</div>}
          </div>
          <div className="field">
            <label>Amount (PRL)</label>
            <input className="input" type="number" inputMode="decimal" step="any" value={amount} onChange={(e) => { setMaxActive(false); setAmount(e.target.value); }} placeholder="0.00" />
          </div>
          <div className="small" style={{ display: "flex", justifyContent: "space-between", margin: "4px 2px 4px" }}>
            <span>Available: {fmt(balance)} PRL</span>
            <button className="btn ghost small" style={{ padding: "4px 10px" }} onClick={() => setMaxActive(true)} disabled={!effRate} title={effRate ? "Send full balance (minus fee)" : "estimating fee…"}>MAX</button>
          </div>
          <div className="small" style={{ display: "flex", justifyContent: "space-between", margin: "0 2px 12px" }}>
            <span>Fee: {feeAtoms ? fmt(feeAtoms) : "…"} PRL</span>
            <span style={{ display: "inline-flex", gap: 4 }}>
              {[["slow","🐢 Slow"],["std","⚡ Std"],["fast","🚀 Fast"]].map(([m,label]) => (
                <button key={m} className={"btn ghost small" + (feeMode===m ? " on" : "")} style={{ padding: "4px 8px" }} onClick={() => setFeeMode(m)}>{label}</button>
              ))}
            </span>
          </div>
          {err && <div className="err">{err}</div>}
          <button className="btn primary" onClick={() => {
            setErr("");
            try { const r = build(); setHex(r.hex); setTxid(r.txid); setStage("review"); }
            catch (e) { setErr(e.message); }
          }} disabled={!to || !amount || !effRate}>Review</button>
        </>
      )}
    </Sheet>
  );
}

function GetPrlSheet({ address, onCopied, onClose }) {
  const [pasted, setPasted] = useState("");
  const [check, setCheck] = useState(null); // null=unchecked | true | false | undefined=read-failed→manual
  const copy = async () => {
    try { await navigator.clipboard.writeText(address); onCopied("Address copied — paste it in SafeTrade"); }
    catch { onCopied("Copy failed — long-press the address to copy manually"); }
  };
  const verify = async () => {
    try {
      const t = await navigator.clipboard.readText();
      setPasted(t);
      setCheck(t.trim() === address);
    } catch { setCheck(undefined); setPasted(""); } // clipboard unreadable → manual mode, never silent
  };
  const addrShown = address;
  return (
    <Sheet title="Get PRL" sub="three ways to fund this wallet" onClose={onClose}>
      <div className="card" style={{ background: "var(--card-2)" }}>
        <div style={{ fontWeight: 700, marginBottom: 4 }}>1 · Withdraw from SafeTrade</div>
        <div className="small">The only exchange listing PRL today. Withdraw → paste your address → double-check the first & last 6 chars → send a small test amount first (min withdrawal fees apply).</div>
        <div className="seed-box" style={{ marginTop: 8, userSelect: "all" }}>{addrShown}</div>
        <button className="btn small" style={{ marginTop: 8 }} onClick={copy}>Copy my address</button>
      </div>
      <div className="card" style={{ background: "var(--card-2)", marginTop: 10 }}>
        <div style={{ fontWeight: 700, marginBottom: 4 }}>2 · OTC desk</div>
        <div className="small">Trading OTC (~$1.16–1.19/PRL)? Ask the desk for settlement to your PearlPurse address — and give them a Schnorr proof-of-address (✍️ Sign) so they know it's yours.</div>
      </div>
      <div className="card" style={{ background: "var(--card-2)", marginTop: 10 }}>
        <div style={{ fontWeight: 700, marginBottom: 4 }}>3 · From another wallet</div>
        <div className="small">Any Pearl wallet can send to your bech32m taproot address. Sender must support bech32m (taproot) withdrawals.</div>
      </div>
      <div className="card" style={{ marginTop: 10 }}>
        <div style={{ fontWeight: 700, marginBottom: 4 }}>✅ Sanity-check the address you pasted</div>
        <div className="small">Clipboard-hijack malware swaps addresses. After pasting your address anywhere, come back and check it landed intact:</div>
        <button className="btn small" style={{ marginTop: 8 }} onClick={verify}>Check my clipboard vs my address</button>
        {check === true && <div className="small" style={{ color: "var(--green)", marginTop: 6 }}>✅ Clipboard matches your address — safe to submit.</div>}
        {check === false && <div className="err" style={{ marginTop: 6 }}>⚠️ CLIPBOARD DOESN'T MATCH. Something changed your copied address — do not submit it. Re-copy above.</div>}
        {check === undefined && (
          <div style={{ marginTop: 8 }}>
            <div className="small" style={{ marginBottom: 4 }}>Couldn't read your clipboard — paste what you submitted below and I'll compare:</div>
            <textarea className="input mono" rows={2} value={pasted} onChange={(e) => setPasted(e.target.value)} />
            <div className="small mt8" style={{ color: pasted.trim() === address ? "var(--green)" : "var(--red)" }}>
              {pasted.trim() ? (pasted.trim() === address ? "✅ Matches your address." : "⚠️ DOES NOT MATCH — do not submit that withdrawal.") : ""}
            </div>
          </div>
        )}
      </div>
      <div className="small mt8 center">Network fee reference: typical send ≈ 0.0001 PRL. Fund with at least 0.01 PRL to be comfortably spendable.</div>
    </Sheet>
  );
}

function SignSheet({ wallet, onClose, notify }) {
  const [msg, setMsg] = useState("");
  const [sig, setSig] = useState("");
  const [busy, setBusy] = useState(false);
  const sign = () => {
    if (!msg.trim()) return;
    setBusy(true);
    setTimeout(() => {
      try {
        const root = HDKey.fromMasterSeed(mnemonicToSeedSync(wallet.mnemonic));
        const priv = derivePriv(root, wallet.index);
        setSig(signMessage(priv, null, msg));
      } catch (e) { notify("Sign failed: " + e.message); }
      setBusy(false);
    }, 30);
  };
  return (
    <Sheet title="Sign message" sub={`proves control of ${short(wallet.address)}`} onClose={onClose}>
      <div className="field">
        <label>Message</label>
        <textarea className="input mono" rows={3} value={msg} onChange={(e) => setMsg(e.target.value)} placeholder="Text to sign — e.g. an OTC proof or login challenge" />
      </div>
      <button className="btn primary" onClick={sign} disabled={!msg.trim() || busy}>{busy ? "Signing…" : "✍️ Sign with this address"}</button>
      {sig && (
        <>
          <div className="field" style={{ marginTop: 14 }}>
            <label>Signature (copy & share)</label>
            <textarea className="input mono" rows={4} readOnly value={sig} />
          </div>
          <div className="row2">
            <button className="btn" onClick={() => { navigator.clipboard.writeText(sig); notify("Signature copied"); }}>Copy signature</button>
            <button className="btn" onClick={() => {
              const text = `Pearl address: ${wallet.address}\nMessage: ${msg}\nSignature: ${sig}`;
              navigator.clipboard.writeText(text); notify("Full proof copied");
            }}>Copy full proof</button>
          </div>
          <div className="small mt8">Anyone can verify this in-app (🔍 Verify) or with any BIP340-Schnorr tool using the PearlMsgSig envelope.</div>
        </>
      )}
    </Sheet>
  );
}

function VerifySheet({ onClose }) {
  const [addr, setAddr] = useState("");
  const [msg, setMsg] = useState("");
  const [sig, setSig] = useState("");
  const [result, setResult] = useState(null); // true | false | null
  const run = () => setResult(verifyMessage(addr, msg, sig));
  return (
    <Sheet title="Verify message" sub="check a Pearl proof-of-address" onClose={onClose}>
      <div className="field">
        <label>Pearl address (prl1…)</label>
        <input className="input mono" value={addr} onChange={(e) => { setAddr(e.target.value); setResult(null); }} placeholder="prl1p…" />
      </div>
      <div className="field">
        <label>Message</label>
        <textarea className="input mono" rows={3} value={msg} onChange={(e) => { setMsg(e.target.value); setResult(null); }} placeholder="The exact text that was signed" />
      </div>
      <div className="field">
        <label>Signature (64-byte hex)</label>
        <textarea className="input mono" rows={3} value={sig} onChange={(e) => { setSig(e.target.value); setResult(null); }} placeholder="a1b2…" />
      </div>
      <button className="btn primary" onClick={run} disabled={!addr.trim() || !msg.trim() || !sig.trim()}>🔍 Verify</button>
      {result === true && (
        <div className="card" style={{ marginTop: 14, textAlign: "center", background: "#223026", borderColor: "#3f5a46" }}>
          <div style={{ fontSize: 34 }}>✅</div>
          <div style={{ fontWeight: 700 }}>Valid signature</div>
          <div className="small mt8">{short(addr)} signed this exact message.</div>
        </div>
      )}
      {result === false && (
        <div className="err" style={{ marginTop: 14, textAlign: "center" }}>
          <div style={{ fontSize: 26 }}>❌</div>
          Invalid — address, message or signature doesn't match.
        </div>
      )}
    </Sheet>
  );
}

function ProofSheet({ wallet, data, onClose, notify }) {
  // OTC proof-of-funds: standardized envelope anyone can verify at /verify
  const [stamp] = useState(() => new Date().toISOString().replace("T", " ").slice(0, 19) + " UTC");
  const proofMsg = `PROOF-OF-FUNDS\naddress: ${wallet.address}\nas-of: ${stamp}\nbalance: ${data ? (Number(data.confirmed) / 1e8).toFixed(8) : "0.00000000"} PRL (confirmed, on-chain at blockbook.pearlresearch.ai)\npurpose: demonstrate control of this address to a counterparty\nnote: proves address control + balance snapshot; not a bank statement`;
  const [sig, setSig] = useState("");
  const [busy, setBusy] = useState(false);
  const make = () => {
    setBusy(true);
    setTimeout(() => {
      try {
        const root = HDKey.fromMasterSeed(mnemonicToSeedSync(wallet.mnemonic));
        const priv = derivePriv(root, wallet.index);
        setSig(signMessage(priv, null, proofMsg));
      } catch (e) { notify("Sign failed: " + e.message); }
      setBusy(false);
    }, 30);
  };
  const envelope = sig ? JSON.stringify({ v: 1, kind: "pearlpurse-proof-of-funds", address: wallet.address, message: proofMsg, sig }, null, 2) : "";
  return (
    <Sheet title="🛡 Proof of funds" sub="OTC-desk standard · verifiable by anyone" onClose={onClose}>
      <div className="warn" style={{ marginBottom: 12 }}>Signs a standardized PROOF-OF-FUNDS message binding your address, a timestamp and its confirmed balance. Anyone can verify the envelope at <b>/verify</b> without trusting us.</div>
      <div className="card mono" style={{ fontSize: 11, whiteSpace: "pre-wrap", wordBreak: "break-all", background: "var(--card-2)", marginBottom: 12 }}>{proofMsg}</div>
      {!sig ? (
        <button className="btn primary" style={{ width: "100%" }} disabled={busy} onClick={make}>{busy ? "Signing…" : "✍️ Sign proof"}</button>
      ) : (
        <>
          <div className="card" style={{ background: "#223026", borderColor: "#3f5a46", marginBottom: 12, textAlign: "center" }}>
            <div style={{ fontSize: 30 }}>✅</div>
            <div style={{ fontWeight: 700 }}>Proof signed</div>
            <div className="small">Send the envelope below to your counterparty.</div>
          </div>
          <div className="card mono" style={{ fontSize: 10.5, whiteSpace: "pre-wrap", wordBreak: "break-all", background: "var(--card-2)", maxHeight: 180, overflow: "auto" }}>{envelope}</div>
          <div className="row2 mt16">
            <button className="btn" onClick={() => navigator.clipboard?.writeText(envelope).then(() => notify("Envelope copied"))}>📋 Copy envelope</button>
            <a className="btn ghost" style={{ textDecoration: "none", textAlign: "center" }} href="/verify" target="_blank" rel="noreferrer">Verify page ↗</a>
          </div>
        </>
      )}
    </Sheet>
  );
}

function BookSheet({ contacts, onChange, onSend, onClose }) {
  const [label, setLabel] = useState("");
  const [addr, setAddr] = useState("");
  const [err, setErr] = useState("");
  const add = () => {
    try {
      if (!addr.trim()) throw new Error("Enter a prl1… address");
      const a = addr.trim().toLowerCase();
      const d = decodePearlAddress(a);
      if (!d || d.version !== 1 || d.program?.length !== 32) throw new Error("Not a valid prl1… taproot address");
      if (contacts.some((c) => c.address === a)) throw new Error("Already in your address book");
      const l = [...contacts, { label: label.trim() || "contact " + (contacts.length + 1), address: a, added: Date.now() }];
      book.save(l); onChange(l); setLabel(""); setAddr(""); setErr("");
    } catch (e) { setErr(e.message); }
  };
  return (
    <Sheet title="📒 Address book" sub="saved on this device only" onClose={onClose}>
      {contacts.length === 0 && <div className="center small" style={{ padding: "10px 0" }}>No contacts yet</div>}
      {contacts.map((c) => (
        <div className="card" key={c.address} style={{ marginBottom: 8, padding: 12 }}>
          <div style={{ fontWeight: 700, fontSize: 14 }}>{c.label}</div>
          <div className="mono small" style={{ wordBreak: "break-all", margin: "4px 0 8px", color: "var(--muted)" }}>{c.address}</div>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn ghost small" style={{ flex: 1 }} onClick={() => onSend(c.address, c.label)}>Send</button>
            <button className="btn ghost small" style={{ flex: 1 }} onClick={() => navigator.clipboard?.writeText(c.address).then(() => alert("Address copied"))}>Copy</button>
            <button className="btn ghost small" onClick={() => { const l = contacts.filter((x) => x.address !== c.address); book.save(l); onChange(l); }}>✕</button>
          </div>
        </div>
      ))}
      <div className="section-label" style={{ marginTop: 6 }}>Add contact</div>
      <div className="field"><label>Label</label><input className="input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="name / purpose" /></div>
      <div className="field"><label>Address</label><input className="input mono" value={addr} onChange={(e) => setAddr(e.target.value)} placeholder="prl1p…" /></div>
      {err && <div className="err">{err}</div>}
      <button className="btn primary" style={{ width: "100%" }} onClick={add}>Add to address book</button>
    </Sheet>
  );
}

function WatchAddSheet({ onAdded, onClose }) {
  const [addr, setAddr] = useState("");
  const [label, setLabel] = useState("");
  const [err, setErr] = useState("");
  const add = () => {
    try {
      const a = addr.trim().toLowerCase();
      const d = decodePearlAddress(a);
      if (!a) throw new Error("Enter a prl1… address");
      if (!d || d.version !== 1 || d.program?.length !== 32) throw new Error("Not a valid prl1… taproot address");
      const l = watchStore.load();
      if (l.some((w) => w.address === a)) throw new Error("Already watching this address");
      const w = { label: label.trim() || "watch " + (l.length + 1), address: a, added: Date.now() };
      l.push(w); watchStore.save(l);
      onAdded(w);
    } catch (e) { setErr(e.message); }
  };
  return (
    <Sheet title="👁 Watch an address" sub="read-only · no keys needed" onClose={onClose}>
      <div className="field"><label>Label (optional)</label><input className="input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. cold vault, friend" /></div>
      <div className="field"><label>Pearl address (prl1…)</label><input className="input mono" value={addr} onChange={(e) => setAddr(e.target.value)} placeholder="prl1p…" /></div>
      {err && <div className="err">{err}</div>}
      <button className="btn primary" style={{ width: "100%" }} onClick={add}>Watch address</button>
    </Sheet>
  );
}

function Sheet({ title, sub, onClose, children }) {
  const ref = useRef();
  useEffect(() => {
    const h = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);
  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="sheet" ref={ref}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", marginBottom: 12 }}>
          <div>
            <h3>{title}</h3>
            {sub && <div className="sub" style={{ marginBottom: 0 }}>{sub}</div>}
          </div>
          <button className="btn ghost small" onClick={onClose}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}
