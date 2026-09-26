// Fee-size regression suite — txVBytes() must match the real wire format from
// buildTx(), and multi-input sends must pay for every input (the old fixed
// 169 vB estimate underpaid every input past the first).
import { txVBytes, buildTx, tweakXOnlyPub } from "../src/lib/pearl.js";
import { schnorr } from "@noble/curves/secp256k1";

let p = 0, f = 0;
const ok = (n, c) => { console.log((c ? "PASS " : "FAIL ") + n); c ? p++ : f++; };
const throws = (n, fn) => { try { fn(); ok(n, false); } catch { ok(n, true); } };

// 1. hand-computed vbytes table (P2TR: 41 B/input base, 43 B/output, 66 raw witness B/input)
for (const [nIn, nOut, want] of [[1,1,111],[1,2,154],[2,1,169],[2,2,212],[3,2,269],[4,2,327],[1,3,197],[5,2,384]]) {
  ok(`txVBytes(${nIn},${nOut}) === ${want}`, txVBytes(nIn, nOut) === want);
}

// 2. input validation
throws("nIn=0 throws", () => txVBytes(0, 2));
throws("nOut=0 throws", () => txVBytes(1, 0));
throws("fractional nIn throws", () => txVBytes(1.5, 2));
throws("negative nIn throws", () => txVBytes(-1, 2));

// 3. cross-check against the actual serialized tx from buildTx()
// weight = 4×base + marker/flag(2×1) + witness; vbytes = ceil(weight/4)
const dummyPriv = (b) => new Uint8Array(32).fill(b);
for (const [nIn, nOut] of [[1,1],[1,2],[2,2],[3,2],[4,3]]) {
  const xOnly = schnorr.getPublicKey(dummyPriv(7));
  const tweaked = tweakXOnlyPub(xOnly).tweakedX;
  const inputs = Array.from({ length: nIn }, (_, i) => ({
    txid: String(i).padStart(64, "0"), vout: i, value: 100000,
    priv: dummyPriv(7), // xOnlyPub omitted on purpose — sigmsg path must derive it
  }));
  const outputs = Array.from({ length: nOut }, () => ({ xOnlyPub: tweaked, value: 1000 }));
  const { hex } = buildTx(inputs, outputs);
  const totalBytes = hex.length / 2;
  const witnessBytes = 66 * nIn;
  const baseBytes = totalBytes - witnessBytes - 2; // minus witness stack + marker/flag
  const weight = 4 * baseBytes + 2 + witnessBytes;
  const fromWire = Math.ceil(weight / 4);
  ok(`wire cross-check (${nIn}in/${nOut}out): txVBytes=${txVBytes(nIn,nOut)} wire=${fromWire}`, fromWire === txVBytes(nIn, nOut));
}

// 4. the fixed-estimate bug is gone: old constant 169 vB underpaid inputs ≥ 2
//    (~57.25 vB per extra input ≈ 29.6k atoms at the observed 0.00517735 PRL/kB)
const OLD_FIXED = 169;
const RATE_PRL_KB = 0.00517735;
for (const nIn of [2, 3, 4]) {
  const shortfallVb = txVBytes(nIn, 2) - OLD_FIXED;
  const shortfallAtoms = Math.round(shortfallVb * RATE_PRL_KB / 1000 * 1e8);
  ok(`old fixed estimate shortfall at ${nIn} inputs = ${shortfallVb} vB (${shortfallAtoms} atoms)`, shortfallVb > 0 && shortfallAtoms > 1400);
}
// and single-input sends no longer overpay the old 169 vB
ok("1-in/2-out now 154 vB (old overpaid 15 vB)", txVBytes(1, 2) === 154 && txVBytes(1, 2) < OLD_FIXED);

// 5. marginal cost sanity: each extra input adds exactly 57.25 vB worth of weight
for (const nIn of [1, 2, 3]) {
  const dW = 4 * (txVBytes(nIn + 1, 2) - txVBytes(nIn, 2));
  ok(`marginal weight of input #${nIn + 1} sane (${dW})`, dW >= 228 && dW <= 232); // 4×57.25=229 ± ceil
}

console.log(`\n${p} passed, ${f} failed`);
process.exit(f ? 1 : 0);
