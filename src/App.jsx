import React, { useEffect, useRef, useState } from "react";
import { generateMnemonic, entropyToMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english";
import { mnemonicToSeedSync, validateMnemonic } from "@scure/bip39";
import { HDKey } from "@scure/bip32";
import { schnorr } from "@noble/curves/secp256k1";
import { addressFromPriv, derivePriv, decodePearlAddress, buildTx, tweakXOnlyPub, PEARL } from "./lib/pearl.js";
import { fetchWalletData, fetchWalletDataMulti, broadcastTx, getEstimateFee, explorerTx, explorerAddr } from "./lib/blockbook.js";
import { qrDataUrl } from "./lib/qr.js";
import { seal, unseal } from "./lib/vault.js";

const ATOM = 100_000_000n;
const fmt = (a) => {
  const neg = a < 0n; const v = neg ? -a : a;
  const whole = v / ATOM, frac = (v % ATOM).toString().padStart(8, "0").replace(/0+$/, "");
  return (neg ? "-" : "") + whole.toLocaleString("en-US") + (frac ? "." + frac.slice(0, 6) : "");
};
const short = (a) => a ? a.slice(0, 10) + "…" + a.slice(-8) : "";

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
  const [data, setData] = useState(null);
  const [sheet, setSheet] = useState(null);
  const [detailTx, setDetailTx] = useState(null); // 'create' | 'import' | 'send' | 'receive' | 'settings'
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");

  useEffect(() => {
    const w = store.load();
    if (!w) return;
    if (w.vault) setLocked(true);
    else setWallet(w); // legacy plaintext (dev only) — wiped on next save
  }, []);

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
    return (
      <Welcome
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
        <button className="btn" onClick={() => setSheet("receive")}>⬇ Receive</button>
        <button className="btn primary" onClick={() => setSheet("send")}>⬆ Send</button>
      </div>

      {error && <div className="err">{error}</div>}

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
                  <div className="sub">{t.confirmations > 0 ? `${t.confirmations.toLocaleString()} confs` : "pending"} · {new Date((t.blockTime || 0) * 1000).toLocaleDateString()}</div>
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
        <button className="btn ghost small" style={{ flex: 1 }} onClick={() => { if (confirm("Wipe wallet from this device? You'll need your seed phrase to recover.")) { store.clear(); setWallet(null); setData(null); } }}>Wipe device</button>
      </div>

      {sheet === "receive" && <ReceiveSheet address={wallet.address} onClose={() => setSheet(null)} notify={notify} />}
      {detailTx && (
        <TxDetailSheet
          tx={detailTx}
          onClose={() => setDetailTx(null)}
          ourAddrs={new Set((data?.addresses || []).map((a) => a.address))}
        />
      )}
      {sheet === "send" && (
        <SendSheet
          wallet={wallet}
          utxos={data?.utxos || []}
          balance={data?.confirmed || 0n}
          onClose={() => setSheet(null)}
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

function Welcome({ onCreate, onImport }) {
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

  return (
    <div className="app">
      <div className="welcome">
        <img className="logo-big" src="/pearl.svg" alt="" />
        <h1>PearlPurse</h1>
        <p>The first mobile wallet for Pearl.<br />Keys live on this device only.</p>

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
            <button className="btn primary" onClick={() => { const m = entropyToMnemonic(crypto.getRandomValues(new Uint8Array(16)), wordlist); setCreated(m); setMode("create"); }}>Create new wallet</button>
            <button className="btn" onClick={() => setMode("import")}>Import seed phrase</button>
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
        <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
          <button className="btn ghost small" style={{ flex: 1 }} onClick={() => navigator.clipboard?.writeText(tx.txid).then(() => alert("Txid copied"))}>Copy txid</button>
          <a className="btn ghost small" style={{ flex: 1, textDecoration: "none", textAlign: "center" }} href={explorerTx(tx.txid)} target="_blank" rel="noreferrer">Explorer ↗</a>
        </div>
      </div>
    </Sheet>
  );
}

function SendSheet({ wallet, utxos, balance, onClose, onSent }) {
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [feeRate, setFeeRate] = useState(null);
  const [stage, setStage] = useState("form"); // form | review | sending | sent
  const [hex, setHex] = useState(null);
  const [err, setErr] = useState("");
  const [txid, setTxid] = useState("");

  useEffect(() => { getEstimateFee(2).then(setFeeRate).catch(() => setFeeRate(0.0052)); }, []);

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
  const oneOutVb = 1 * 31 + 10 + 12 + 68 + Math.ceil(66 / 4);
  const rateAtoms = feeRate ? BigInt(Math.round(feeRate * 1e8)) : 0n; // atoms per kB
  const feeFor = (vb) => rateAtoms * BigInt(vb) / 1000n + 1400n; // +dust-buffer for rounding
  const [feeAtoms, setFeeAtoms] = useState(0n);
  useEffect(() => { if (feeRate) setFeeAtoms(feeFor(vbytes)); }, [feeRate]);

  const build = () => {
    const d = decodePearlAddress(to.trim());
    if (!d || d.version !== 1 || d.program?.length !== 32) throw new Error("Not a valid prl1… taproot address");
    if (amtAtoms <= 0n) throw new Error("Enter an amount");
    if (amtAtoms + feeAtoms > balance) throw new Error("Amount + fee exceeds balance");
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
            <div className="kv"><span className="k">Rate</span><span className="mono">{feeRate?.toFixed(5)} PRL/kB</span></div>
          </div>
          {err && <div className="err">{err}</div>}
          <div className="row2 mt16">
            <button className="btn" onClick={() => setStage("form")}>Back</button>
            <button className="btn primary" onClick={submit}>Confirm & send</button>
          </div>
        </>
      ) : (
        <>
          <div className="field">
            <label>Recipient</label>
            <input className="input mono" value={to} onChange={(e) => setTo(e.target.value)} placeholder="prl1p…" />
          </div>
          <div className="field">
            <label>Amount (PRL)</label>
            <input className="input" type="number" inputMode="decimal" step="0.0001" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
          </div>
          <div className="small" style={{ display: "flex", justifyContent: "space-between", margin: "4px 2px 12px" }}>
            <span>Available: {fmt(balance)} PRL</span>
            <button className="btn ghost small" style={{ padding: "4px 10px" }} onClick={() => setAmount(((balance - feeFor(oneOutVb)) / ATOM).toString())}>MAX</button>
          </div>
          {err && <div className="err">{err}</div>}
          <button className="btn primary" onClick={() => {
            setErr("");
            try { const r = build(); setHex(r.hex); setTxid(r.txid); setStage("review"); }
            catch (e) { setErr(e.message); }
          }} disabled={!to || !amount}>Review</button>
        </>
      )}
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
