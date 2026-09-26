// Compare my BIP341 sighash vs Go digests
import { readFileSync } from 'fs';
import { HDKey } from '@scure/bip32';
import { mnemonicToSeedSync } from '@scure/bip39';
import { schnorr } from '@noble/curves/secp256k1';
import { derivePriv, decodeBech32m, taggedHash, tweakXOnlyPub, p2trScript, varint, u32le, u64le } from '../src/lib/pearl.js';
import { sha256 } from '@noble/hashes/sha256';
const dblSha = (b) => sha256(b); // v1 midstates: SINGLE sha on Pearl

const vecs = JSON.parse(readFileSync('/tmp/pearl-vectors.json', 'utf8'));
const goDigests = {
  'basic-1in-2out': '0765e3bfbcbcac2d33096993db33588b0853955093d6ef1a37853c82b9afbc24',
  '1in-1out-seq': 'bf2149f20beb61d7b509e41f283bea6fb3c8097becc026fc8ff15b395af508a1',
  'small-value': '3132eb4e76056eba476ff18e1c72c671a017306379bdf2972e5c64035dd6127d',
};

const seed = mnemonicToSeedSync('abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about');
const root = HDKey.fromMasterSeed(seed);
const priv0 = derivePriv(root, 0);
const x0 = schnorr.getPublicKey(priv0); // internal x-only of spender

const txidLE = (h) => h.match(/../g).reverse().map((x) => parseInt(x, 16));

for (const t of vecs.txs) {
  const inputs = [{ txid: t.prevTxid, vout: t.prevVout, value: t.prevValue, xOnlyPub: x0 }];
  const outputs = t.outputs.map((o) => ({ xOnlyPub: decodeBech32m(o.address).program, value: o.value }));

  const hashPrevOuts = dblSha(Uint8Array.from(inputs.flatMap((i) => [...txidLE(i.txid), ...u32le(i.vout)])));
  const hashAmounts = dblSha(Uint8Array.from(inputs.flatMap((i) => u64le(i.value))));
  const hashScripts = dblSha(Uint8Array.from(inputs.flatMap((i) => { const s = p2trScript(tweakXOnlyPub(i.xOnlyPub).tweakedX); return [...varint(s.length), ...s]; })));
  const hashSequence = dblSha(Uint8Array.from(inputs.flatMap(() => u32le(t.sequence))));
  const hashOutputs = dblSha(Uint8Array.from(outputs.flatMap((o) => { const s = p2trScript(o.xOnlyPub); return [...u64le(o.value), ...varint(s.length), ...s]; })));

  const msg = Uint8Array.from([
    0x00, 0x00,
    ...u32le(1), ...u32le(0),
    ...hashPrevOuts, ...hashAmounts, ...hashScripts, ...hashSequence, ...hashOutputs,
    0x00, ...u32le(0),
  ]);
  const mine = Buffer.from(taggedHash('TapSighash', msg)).toString('hex');
  console.log(t.label.padEnd(16), 'mine:', mine);
  console.log(''.padEnd(16), 'GO  :', goDigests[t.label], mine === goDigests[t.label] ? '✅' : '❌');
}
