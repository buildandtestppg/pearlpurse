// Security regression suite — adversarial inputs must be rejected, not crash or silently pass
import { decodeBech32m, decodePearlAddress, buildTx, encodeBech32m, PEARL } from "../src/lib/pearl.js";
import { unseal, seal } from "../src/lib/vault.js";
let p = 0, f = 0;
const ok = (n, c) => { console.log((c ? "PASS " : "FAIL ") + n); c ? p++ : f++; };
const rejects = async (n, fn) => {
  try { await fn(); ok(n, false); } catch { ok(n, true); }
};
const rejectsSync = (n, fn) => {
  try { fn(); ok(n, false); } catch { ok(n, true); }
};

const VALID = "prl1pr6yuq8u2r95wjzzgpdy8cpnncpl7l8zgy6x5q0367pnc53s2famqg7pt74";

// bech32m adversarial inputs
rejectsSync("bad checksum rejected", () => decodeBech32m(VALID.slice(0, -1) + (VALID.endsWith("4") ? "5" : "4")));
rejectsSync("mixed case rejected", () => decodeBech32m("pRl1" + VALID.slice(4)));
rejectsSync("bad hrp chars rejected", () => decodeBech32m("p!l1" + VALID.slice(4)));
rejectsSync("wrong hrp (bitcoin) rejected", () => {
  const { program } = decodeBech32m(VALID);
  decodeBech32m(encodeBech32m("bc", new Uint8Array([1, ...program.slice(1)]))); // re-encode under bc hrp
});
ok("correct hrp accepted", decodeBech32m(VALID).hrp === "prl");
rejectsSync("non-string rejected", () => decodeBech32m(123));
rejectsSync("v0/v2 program (20B) rejected", () => {
  // craft 20-byte program with valid checksum → decode must reject (len != 32)
  const { program } = decodeBech32m(VALID);
  const short = program.slice(0, 20);
  const { version } = decodeBech32m(VALID);
  // build a bech32m v1 with 20-byte payload manually: charset encode
  // simpler: expect decode to reject because convertBits yields 20 bytes
  const enc = encodeBech32m("prl", new Uint8Array(short));
  decodeBech32m(enc);
});

// buildTx adversarial
rejectsSync("empty inputs rejected", () => buildTx([], [{ xOnlyPub: new Uint8Array(32), value: 1000 }]));
rejectsSync("empty outputs rejected", () => buildTx([{ txid: "0".repeat(64), vout: 0, value: 1000, priv: new Uint8Array(32).fill(1) }], []));
rejectsSync("bad txid rejected", () => buildTx([{ txid: "xyz", vout: 0, value: 1000, priv: new Uint8Array(32).fill(1) }], [{ xOnlyPub: new Uint8Array(32), value: 1000 }]));
rejectsSync("negative vout rejected", () => buildTx([{ txid: "0".repeat(64), vout: -1, value: 1000, priv: new Uint8Array(32).fill(1) }], [{ xOnlyPub: new Uint8Array(32), value: 1000 }]));
rejectsSync("fractional value rejected", () => buildTx([{ txid: "0".repeat(64), vout: 0, value: 1000, priv: new Uint8Array(32).fill(1) }], [{ xOnlyPub: new Uint8Array(32), value: 1.5 }]));
rejectsSync("oversized value rejected", () => buildTx([{ txid: "0".repeat(64), vout: 0, value: 1000, priv: new Uint8Array(32).fill(1) }], [{ xOnlyPub: new Uint8Array(32), value: 9.9e18 }]));

// vault adversarial
await rejects("password < 8 chars rejected", () => seal("x y z", "short"));
const v = await seal("abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about", "password123");
ok("vault round-trip NFKC", (await unseal(v, "password123")).startsWith("abandon"));
await rejects("wrong password rejected", () => unseal(v, "password124"));
await rejects("tampered vault rejected", () => unseal({ ...v, ct: v.ct.slice(0, 8) }, "password123"));
await rejects("unknown version rejected", () => unseal({ ...v, v: 2 }, "password123"));

// amount parsing (exposed via regex shape — mirrors App.jsx logic)
const amtRe = /^\d+(?:\.(\d{1,8}))?$/;
ok("amount '1.5' valid", amtRe.test("1.5"));
ok("amount '.5' invalid (forces 0)", !amtRe.test(".5"));
ok("amount 1e8 invalid", !amtRe.test("1e8"));
ok("amount '-1' invalid", !amtRe.test("-1"));
ok("amount '1.123456789' invalid", !amtRe.test("1.123456789"));

// cross-chain paste: valid bech32m but wrong network must be rejected by decodePearlAddress
const { program } = decodeBech32m(VALID);
const btcAddr = encodeBech32m("bc", new Uint8Array([1, ...program]));
rejectsSync("bitcoin bc1p… rejected (cross-chain paste)", () => decodePearlAddress(btcAddr));
ok("pearl address accepted by strict decoder", decodePearlAddress(VALID).hrp === "prl");

console.log(`${p} passed, ${f} failed`);
process.exit(f ? 1 : 0);
