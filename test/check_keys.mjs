import { schnorr } from '@noble/curves/secp256k1';
import { HDKey } from '@scure/bip32';
import { mnemonicToSeedSync } from '@scure/bip39';
import { readFileSync } from 'fs';

const seed = mnemonicToSeedSync('abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about');
const root = HDKey.fromMasterSeed(seed);
const vecs = JSON.parse(readFileSync('/tmp/pearl-vectors.json', 'utf8'));

const hex = (b) => Buffer.from(b).toString('hex');

for (let i = 0; i < 5; i++) {
  const child = root.derive(`m/86'/808276'/0'/0/${i}`);
  console.log(i, 'priv', hex(child.privateKey));
  console.log(i, 'xonly', hex(schnorr.getPublicKey(child.privateKey)));
}
console.log('--- vectors ---');
for (const a of vecs.addresses) console.log(a.index, 'priv', a.privHex, 'internal', a.internal);
