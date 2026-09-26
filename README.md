# PearlPurse 🫧

**The first web wallet for [Pearl](https://pearlresearch.ai) ($PRL).** Non-custodial, encrypted, runs entirely in your browser.

**🔗 Live: [pearlpurse.vercel.app](https://pearlpurse.vercel.app)**

No accounts. No servers holding your keys. Your seed never leaves the browser — encrypted at rest with your password (PBKDF2-600k + AES-256-GCM), unlocked only by you.

## Features

- **Create / import** BIP39 seed → BIP86 native taproot (bech32m `prl1p…`) addresses, derivation `m/86'/808276'/0'/0/i`
- **Address rotation** — Electrum-style gap-20 discovery, auto-advance on receive, manual ↻, change goes to a fresh address (privacy by default)
- **Send** with UTXO selection, fee estimation, and consensus-exact signing (Pearl's v1 sighash: SINGLE via sha256 midstates, verified against real mainnet transactions)
- **Receive** with QR codes and a rotating address queue
- **Activity** with per-wallet net amounts (not whole-tx totals), full in-app transaction detail (inputs/outputs, your addresses marked), and explorer links
- **Encrypted vault** — PBKDF2-600k rounds + AES-256-GCM, wiped from memory on lock
- **Same-origin API relay** — the wallet talks to BlockBook through a serverless relay (`api/`), no third-party API keys in your browser, no CORS gymnastics

## Security model

| Layer | Approach |
|---|---|
| Keys | Generated in-browser (`@noble`/`@scure` libraries), never transmitted |
| Vault | Seed encrypted with your password before touching `localStorage` |
| Signing | All transaction construction + signing client-side; relay only proxies **read-only** BlockBook calls and broadcast |
| Supply chain | 6 pinned runtime dependencies, no wallet SDK, no analytics |

**Known gaps (honest list):** no SPV validation (trusts the BlockBook indexer for balances), vault lives in `localStorage` (clear-browser-data = cleared wallet), no post-quantum XMSS yet. Details in [SECURITY.md](SECURITY.md).

⚠️ **This is young software handling real money on a young chain. Start with amounts you can afford to lose, and keep your seed phrase written down offline.**

## Run it locally

```bash
git clone https://github.com/buildandtestppg/pearlpurse.git
cd pearlpurse
npm install
npm run dev        # vite dev server
```

## Tests

```bash
npm test           # vectors · system · security · vault · rotation (79 assertions)
```

- `test/vectors.test.mjs` — signing vectors incl. real mainnet transactions
- `test/system.test.mjs` — block mapping, balance math, net-amount display logic
- `test/security.test.mjs` — vault crypto, lock/wipe, input hardening
- `test/rotation.test.mjs` — gap-limit discovery and rotation flows

## Architecture

```
src/
  lib/pearl.js      # BIP39/BIP86 derivation, address encoding, tx build + sign
  lib/blockbook.js  # BlockBook client (via same-origin relay), tx mapping, fees
  lib/vault.js      # encrypted vault (PBKDF2-600k + AES-256-GCM)
  lib/qr.js         # QR rendering
  App.jsx           # the whole UI — one file, React
api/v1|v2/          # serverless relay (read-only proxy + broadcast), same-origin
scripts/ui_smoke.py # headless-Chrome unlock smoke test (create → lock → unlock)
```

Deploy target is Vercel (`vercel.json`, Node 22 for the api fns). `deploy.sh` ships via the Vercel API.

## Roadmap

- [ ] Post-quantum XMSS address support (Pearl's optional PQ scheme)
- [ ] SPV / trustless balance verification
- [ ] P2P "Buy PRL" escrow (tapscript 2-of-2) — onboarding without SafeTrade
- [ ] PRL ↔ BTC atomic swaps (HTLC primitives already proven on-chain: [pearl-htlc](https://github.com/buildandtestppg/pearl-htlc))

## Contributing

Issues and PRs welcome — see [CONTRIBUTING.md](CONTRIBUTING.md). Good first issues: SPV research, i18n, UI polish, test coverage for edge-case scripts.

## License

[ISC](LICENSE) — use it, fork it, ship products on it.

---

*Not affiliated with Pearl Research Labs. Pearl ($PRL) is an independent PoUW L1.*
