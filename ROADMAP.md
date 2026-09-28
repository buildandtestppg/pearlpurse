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
| v0.4.23 | Revamp batch 3 (final): get-started + roadmap art bands, iridescent CTA sheen (reduced-motion safe), gradient balance display, microcap section labels, card hover lift. Vision verdict: product-grade, ship-ready, zero default-styled elements |
| v0.4.22 | Typography revamp: self-hosted Space Grotesk variable font (22KB woff2, CSP-clean, zero external font requests) across all six surfaces — home, app, get-started, security, roadmap, verify |
| v0.4.21 | 🎨 Revamp batch 1: new PWA icon set (generated pearl icon — 192/512/maskable/apple-touch), app empty-state illustration (oyster, "The sea is calm"), welcome + lock screen art, security page oyster header. Vision-critiqued: "product-grade" |
| v0.4.20 | Hero art cranked to full-bleed (pearl visible at first glance, left-gradient readability) + full-width pearl art band with tagline above install section |
| v0.4.19 | 🎨 Generated hero art: luminous pearl on dark seabed (AI image gen, palette-matched), masked right-side integration + og.png social card (1200×630) + twitter:card — link unfurls now show the pearl |
| v0.4.18 | 🔐 Safety pack: recovery drill (3-of-12 words, randomized), encrypted vault backup export + restore test, backup status on account card. HOTFIX: seed import broken since v0.4.13 refactor — fixed with gap-limit resume |
| v0.4.17 | 🛡 OTC proof-of-funds standard: standardized envelope (address + timestamp + confirmed balance, Schnorr-signed), standalone /verify page (100% client-side, zero network calls). Blockbook failover: relay serves ≤10-min stale data with X-Pearlpurse-Stale on upstream failure |
| v0.4.15 | Home network strip upgraded: PRL price + network hashrate via prlstats.com relay (same-origin /api/prlstats, 5-min cache, attribution; difficulty now always populated) |
| v0.4.14 | Dual-review hardening: duplicate-address guards (watch + book), BigInt crash guard, watch-add sheet from wallet view (was dead button), offline address validation (fresh cold addresses watchable, no on-chain probe = more private), resume-watching on welcome |
| v0.4.13 | Parity features: 👁 watch-only wallets (standalone read-only mode, no wallet needed), 📒 address book (contacts → one-tap prefilled send), 📝 private tx notes, live difficulty stat on home. Rival-scan: 6-wallet ecosystem, none with reproducible builds + public security page |
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
