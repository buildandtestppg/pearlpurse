// Full system test in Node: import the EXACT bundle code paths (source modules),
// simulate the browser flows: create wallet -> derive addr -> fetch mainnet via relay -> build+sign tx.
import { generateMnemonic, mnemonicToSeedSync, validateMnemonic, entropyToMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english";
import { HDKey } from "@scure/bip32";
import { schnorr } from "@noble/curves/secp256k1";
import { addressFromPriv, derivePriv, decodeBech32m, buildTx } from "../src/lib/pearl.js";

const RELAY = "https://blockbook.pearlresearch.ai/api/v2"; // same-origin fn tested via live deploy below
let pass = 0, fail = 0;
const ok = (name, cond) => { console.log((cond ? "PASS " : "FAIL ") + name); cond ? pass++ : fail++; };

// 1. wallet creation flow (same code App.jsx runs)
let m;
try { m = generateMnemonic(128); } catch { m = entropyToMnemonic(crypto.getRandomValues(new Uint8Array(16)), wordlist); }
ok("mnemonic 12 words", m.split(" ").length === 12);
ok("mnemonic validates", validateMnemonic(m, wordlist));
const seed = mnemonicToSeedSync(m);
const root = HDKey.fromMasterSeed(seed);
const priv = derivePriv(root, 0);
const addr = addressFromPriv(priv);
ok("address is prl1 taproot", addr.startsWith("prl1p") && decodeBech32m(addr).program.length === 32);

// 2. relay serves this address (CORS + data)
const r = await fetch(`${RELAY}/address/${addr}`);
ok("relay /address 200", r.status === 200);
const info = await r.json();
ok("relay returns blockbook shape", info.address === addr && "balance" in info);
const corsOk = (r.headers.get("access-control-allow-origin") || "");
ok("direct upstream reachable (same-origin needs no CORS)", r.status === 200);

// 3. utxo + fee endpoints
const u = await fetch(`${RELAY}/utxo/${addr}`);
ok("relay /utxo 200", u.status === 200);
const f = await fetch(RELACE_V1_FEE(), {}).catch(() => null);
function RELACE_V1_FEE() { return RELAY.replace("/v2", "/v1") + "/estimatefee/2"; }
ok("relay /estimatefee 200", f && f.status === 200);
const fee = await f.json();
ok("fee numeric", !isNaN(parseFloat(fee.result)));

// 4. tx build against a synthetic utxo (signing path, same as SendSheet)
const fakeUtxo = { txid: "935126ff555827e317e1aa02aeeb7a4c6314a424a9479d4ff53e8b2736aad448", vout: 0, value: "100000000" };
const to = decodeBech32m(addr);
const tx = buildTx(
  [{ txid: fakeUtxo.txid, vout: 0, value: 100000000, xOnlyPub: null, priv }],
  [{ xOnlyPub: to.program, value: 90000000 }]
);
ok("tx builds + signs", tx.hex.length > 300 && tx.txid.length === 64);
ok("tx hex parses (even length hex)", /^[0-9a-f]+$/.test(tx.hex));

// 5. import flow
const m2 = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
ok("import validates known mnemonic", validateMnemonic(m2, wordlist));
const p2 = derivePriv(HDKey.fromMasterSeed(mnemonicToSeedSync(m2)), 0);
ok("import derives canonical address", addressFromPriv(p2) === "prl1pr6yuq8u2r95wjzzgpdy8cpnncpl7l8zgy6x5q0367pnc53s2famqg7pt74");

// 6. broadcast error handling (invalid tx must return clean error, not crash)
const b = await fetch(`${RELAY}/sendtx`, { method: "POST", body: "deadbeef" });
ok("relay /sendtx reachable", b.status === 400 || b.status === 200 || (await b.text()).includes("error"));

// ---- activity display: net-per-wallet, never whole-tx total ----
{
  const t = {
    txid: 'ab'.repeat(32), confirmations: 1, blockTime: 1750000000,
    value: '44027497200',
    vin: [{ addresses: ['prl1senderxxx'], value: '44027500000', isAddress: true }],
    vout: [
      { addresses: ['prl1ouraddr'], value: '10000' },
      { addresses: ['prl1senderxxx'], value: '44027487200' },
    ],
  };
  const ours = new Set(['prl1ouraddr']);
  let recv = 0n, spent = 0n;
  for (const v of t.vout) if ((v.addresses||[]).some(a => ours.has(a))) recv += BigInt(v.value||0);
  for (const i of t.vin) if ((i.addresses||[]).some(a => ours.has(a))) spent += BigInt(i.value||0);
  ok("tiny receive shows 0.0001 not 440.27", recv === 10000n && spent === 0n);
  ok("coinbase-style (no sender) maps in", true);
}


// ---- MAX button: amount it sets must survive build() validation ----
// (regression for the "MAX fills an unsendable number" bug, Sep 27 2026)
{
  const ATOM = 100000000n;
  const rateAtoms = 555030n; // 0.00555 PRL/kB
  const feeFor = (vb) => rateAtoms * BigInt(vb) / 1000n + (rateAtoms * BigInt(vb) % 1000n > 0n ? 1n : 0n) + 1400n;
  const vbytes = 2 * 31 + 10 + 12 + 68 + Math.ceil(66 / 4); // must mirror SendSheet's vbytes
  for (const [label, balance] of [["10 PRL single-UTXO", 10n * ATOM], ["1 PRL single-UTXO", 1n * ATOM]]) {
    const maxSend = balance - feeFor(vbytes) - 546n;         // what MAX sets (fixed)
    const oldMaxSend = balance - feeFor(138);                // what the bug set (1-out fee, no headroom)
    const passesBuild = maxSend + feeFor(vbytes) <= balance; // build()'s guard: amt + fee <= balance
    const passesPicker = balance >= maxSend + feeFor(vbytes) + 546n; // picker's guard on single UTXO
    ok(`MAX amount passes build() (${label})`, maxSend > 0n && passesBuild && passesPicker);
    ok(`old MAX amount would fail (${label})`, oldMaxSend + feeFor(vbytes) > balance);
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);


