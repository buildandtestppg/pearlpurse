// Vault round-trip + wrong-password + tamper detection (Node webcrypto = browser crypto.subtle)
import { seal, unseal } from "../src/lib/vault.js";
let p = 0, f = 0;
const ok = (n, c) => { console.log((c ? "PASS " : "FAIL ") + n); c ? p++ : f++; };

// deterministic randomness for test
const v = await seal("abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about", "hunter2222");
ok("seal → v1 shape", v.v === 1 && v.kdf === "PBKDF2-SHA256" && v.iter === 600000 && v.salt && v.iv && v.ct);
ok("ciphertext not plaintext", !v.ct.includes("abandon") && !JSON.stringify(v).includes("abandon"));
const m = await unseal(v, "hunter2222");
ok("round-trip", m.startsWith("abandon"));
let wrong = false;
try { await unseal(v, "hunter9999"); } catch { wrong = true; }
ok("wrong password rejected", wrong);
const tampered = { ...v, ct: v.ct.slice(0, -4) + "AAAA" };
let tam = false;
try { await unseal(tampered, "hunter2222"); } catch { tam = true; }
ok("tampered ciphertext rejected", tam);
let short = false;
try { await seal("x", "short"); } catch { short = true; }
ok("short password rejected at seal", short);
console.log(`${p} passed, ${f} failed`);
process.exit(f ? 1 : 0);
