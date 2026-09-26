# Security Policy

## Reporting a Vulnerability

**Email: mojojojoppgweb3@gmail.com** (or open a private security advisory: Security tab → "Report a vulnerability").

Please include: what you found, reproduction steps, and impact. You'll hear back within 72 hours. Coordinated disclosure preferred — we'll credit you in the advisory unless you prefer otherwise.

## Threat Model

PearlPurse is a client-side wallet. The browser is the vault; the relay only proxies read-only BlockBook queries and transaction broadcast.

| Asset | Protection |
|---|---|
| Seed phrase | Never leaves the browser. Encrypted at rest (PBKDF2-600k + AES-256-GCM) under `localStorage` key `pp-vault`. Plaintext exists only in RAM while unlocked. |
| Password | Never stored; only the KDF output. |
| Transactions | Built + signed entirely client-side. |
| Network | BlockBook queries proxied same-origin via `api/` serverless functions — no third-party keys in the client, no CORS exceptions. |

## Known Limitations (be honest with users)

1. **No SPV** — balances come from the BlockBook indexer (`blockbook.pearlresearch.ai`). A malicious/compromised indexer could lie about balances and UTXOs. Signing remains safe (you'd never sign away more than you intend, but you could be shown fake incoming funds). SPV verification is on the roadmap.
2. **localStorage vault** — browser-profile-local. Clearing site data wipes the wallet (seed phrase recovery still works). Not protected against a compromised device.
3. **No post-quantum XMSS** — standard BIP86 schnorr/taproot only, for now.
4. **No CSP header** — planned hardening item.

## Audit History

- **R1 (Sep 2026)** — 3-way multi-model review (GLM-5.3 + GLM-5.2 + self). Fixed: transaction change-tweak bug, HRP validation guard, relay 405/413 handling. 69/69 checks at the time; 79/79 today.

*No third-party formal audit has been performed. This is experimental software — use amounts you can afford to lose.*
