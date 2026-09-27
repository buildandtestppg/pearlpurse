# PearlPurse Roadmap

Public and versioned — this file is the source of truth, updated every release.
Last updated: **v0.4.10** (Sep 27, 2026). Live page: **/roadmap**.

## ✅ Shipped

| Version | Highlights |
|---|---|
| v0.4.0 | Address rotation (gap-20 discovery), multi-address balance/spend, encrypted vault (PBKDF2-600k AES-256-GCM) |
| v0.4.2–4.3 | Net-per-wallet activity display, explorer links, tx detail sheet, white-screen crash fix, OSS scaffolding |
| v0.4.5–4.6 | Honest fee UX, MAX-button correctness (browser-proven), network-aware "can't send yet" advisory with slow-mode escape hatch |
| v0.4.7 | Real fee curve (1/2/5-block targets from the chain, multiplier model demoted to fallback), live network status in-app |
| v0.4.8 | Sign/verify messages (Schnorr proof-of-address), PWA install (manifest + icons), strict CSP + security headers |
| v0.4.12 | Fact-sweep: removed all "first wallet" claims (6 Pearl wallets predate us — May 2026 onward), honest positioning, human-readable fee display, ghost-button contrast. Visual QA: mobile+desktop overflow-proven clean |
| v0.4.11 | Marketing home page at / (live network stats, features grid), wallet moved to /app, returning users auto-skip, content-verified pages + check_pages.sh |
| v0.4.9–4.10 | `pearl:` URI v0 (payment links), Get-PRL funding funnel with clipboard sanity-check, /get-started + /security pages, reproducible signed-checksum releases, dual-model review process |

## 🔨 Now (in flight)

- **OTC proof-of-funds standard** — public verify page (address + message + signature, no wallet needed), one-click signed PoF statements. Pitch desks to require it → desks become the acquisition channel.
- **Blockbook failover** — health-checked backup endpoints + cached last-known state with a loud stale banner. One indexer outage must never read as "the wallet ate my funds".

## ⏭ Next (1–2 months)

- **Never-lose-your-keys pack** — verified encrypted backup export, recovery-drill mode (restore a throwaway wallet), first-send confirmation.
- **@prlnet tip bot** — X handle ↔ address binding via signed SIWP messages; claim-funds-or-lose-them installs the wallet. Capped hot float, nightly sweep.
- **Multi-UTXO fee estimate** — per-input fee model for wallets with many UTXOs (currently single-input modeled + headroom).

## 🏔 Later (quarter+)

- **Vault** — watch-only xpub import (treasuries, desks, cold storage) → 2-of-3 taproot multisig with timelocked recovery.
- **PearlSwap** — non-custodial HTLC swap coordinator (PRL ↔ BTC, Boltz-style) + extracted Pearl SDK. Ends single-exchange dependency. Non-custodial by design (no escrow, no custody surface).

## 🌙 Moonshot (starting early, shipping late)

- **Pearls** — inscriptions on Pearl UTXOs + PSBT-atomic marketplace. Zero custody, zero capital, pure protocol.

## ✂️ Explicitly not doing (and why)

- **P2P escrow marketplace** — regulatory third rail (custody/transfer facilitation) for a Singapore-based maintainer
- **Book-based DEX** — two-sided cold start on a one-exchange chain
- **Wrapped PRL ↔ EVM bridge** — custody honeypot, most-exploited primitive in crypto
- **Native iOS/Android shells** — store-review gauntlets slow hotfixes; the PWA installs like an app today
- **Fiat on-ramps** — KYC ramps won't list a one-exchange coin; the SafeTrade funnel covers acquisition
- **Airdrops/points** — mercenary churn, no on-chain retention
- **XMSS (post-quantum)** — stateful one-time keys have catastrophic failure modes; revisit after audits

## Process

Every change ships through: browser-repro verification (real headless Chrome against the built bundle),
88-test suite, and **dual-model code review** (GLM-5.3 depth pass + GLM-5.3-flash integration pass — they
catch disjoint bug classes). Releases are reproducible; checksums published at /security.
