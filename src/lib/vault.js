// Encrypted vault — industry standard (MetaMask/Phantom pattern):
// PBKDF2-SHA256 600k iterations → AES-256-GCM, random salt+IV per wallet.
// Password is NEVER stored. Decrypted seed exists in memory only.

const enc = new TextEncoder();
const dec = new TextDecoder();

const b64 = (u8) => btoa(String.fromCharCode(...u8));
const ub64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function deriveKey(password, salt, iterations) {
  const base = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

export async function seal(mnemonic, password) {
  if (password.length < 8) throw new Error("Password must be at least 8 characters");
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const t0 = performance.now();
  const key = await deriveKey(password, salt, 600_000);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(mnemonic)));
  return { v: 1, kdf: "PBKDF2-SHA256", iter: 600000, salt: b64(salt), iv: b64(iv), ct: b64(ct), ms: Math.round(performance.now() - t0) };
}

export async function unseal(vault, password) {
  if (vault?.v !== 1) throw new Error("Unknown vault version");
  const key = await deriveKey(password, ub64(vault.salt), vault.iter);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: ub64(vault.iv) }, key, ub64(vault.ct));
  return dec.decode(pt); // GCM auth tag → throws on wrong password
}
