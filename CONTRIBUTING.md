# Contributing to PearlPurse

Thanks for helping build the first Pearl web wallet 🫧

## Ground rules

- **Non-custodial, always.** No feature may transmit the seed, private keys, or decrypted vault material anywhere. Keys live in the browser, period.
- **Test what you ship.** Every PR should keep `npm test` green (79 assertions across vectors/system/security/vault/rotation). New logic needs new tests.
- **Funds-touching code gets extra review.** Changes to signing, UTXO selection, vault crypto, or the relay require a second reviewer and real-vector test coverage (see `test/vectors.test.mjs` for the pattern).
- **No telemetry/analytics.** The wallet ships zero trackers; keep it that way.

## Dev setup

```bash
npm install
npm run dev     # vite dev server
npm test        # full suite
```

The relay (`api/`) runs on Vercel serverless — local dev can hit BlockBook directly; `vercel.json` maps `/api/*` in production.

## What's helpful right now

- 🧮 **SPV research** — trustless balance verification (header chain verification against BlockBook)
- 🌍 **i18n** — UI strings are all in `App.jsx`; string extraction is welcome
- 🎨 **UI polish** — mobile ergonomics, accessibility (a11y labels, contrast)
- 🧪 **Edge-case tests** — unusual scripts, dust outputs, multi-input spends
- 🔍 **Documentation** — Pearl's BIP86 specifics documented from source (`pearl.js` headers)

## PR checklist

- [ ] `npm test` green
- [ ] No new runtime dependencies without discussion (currently 6 — keep it lean)
- [ ] Funds-touching changes: describe how you verified (vectors, mainnet-shape tests)
- [ ] UI changes: tested on mobile viewport

## Reporting security issues

See [SECURITY.md](SECURITY.md) — do **not** open public issues for vulnerabilities.
