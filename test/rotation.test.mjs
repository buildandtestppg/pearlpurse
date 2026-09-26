// Rotation + discovery tests — the v2 core
import { mnemonicToSeedSync, generateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english";
import { HDKey } from "@scure/bip32";
import { addressFromPriv, derivePriv } from "../src/lib/pearl.js";
import assert from "node:assert";

let p = 0, f = 0;
const ok = (n, c) => { console.log((c ? "PASS " : "FAIL ") + n); c ? p++ : f++; };

// determinism: same seed → same address sequence
const M = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
const root = HDKey.fromMasterSeed(mnemonicToSeedSync(M));
const a0 = addressFromPriv(derivePriv(root, 0));
const a0b = addressFromPriv(derivePriv(HDKey.fromMasterSeed(mnemonicToSeedSync(M)), 0));
ok("derivation deterministic", a0 === a0b);
ok("address 0 starts prl1p", a0.startsWith("prl1p"));
ok("address 1 differs from 0", addressFromPriv(derivePriv(root, 1)) !== a0);
ok("address 20 differs from 19", addressFromPriv(derivePriv(root, 20)) !== addressFromPriv(derivePriv(root, 19)));

// index independence: 50 addresses all unique
const set = new Set();
for (let i = 0; i < 50; i++) set.add(addressFromPriv(derivePriv(root, i)));
ok("50 derived addresses all unique", set.size === 50);

// live blockbook: basic probe shape (works when network up)
try {
  const { fetchAddressBasic, fetchWalletDataMulti } = await import("../src/lib/blockbook.js");
  const b = await fetchAddressBasic(a0);
  ok("live basic probe returns tx count", (typeof b.txs === "number" || typeof b.txCount === "number"));
  const multi = await fetchWalletDataMulti([{ address: a0, index: 0 }, { address: addressFromPriv(derivePriv(root, 1)), index: 1 }]);
  ok("multi fetch aggregates", typeof multi.confirmed === "bigint" && Array.isArray(multi.utxos));
  ok("multi tags index", multi.utxos.every((u) => typeof u.index === "number"));
} catch (e) {
  console.log("SKIP live tests (" + e.message.slice(0, 60) + ")");
}

console.log(`${p} passed, ${f} failed`);
process.exit(f ? 1 : 0);
