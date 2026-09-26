// Diagnose tweak: internal matches, tweaked doesn't. Compare directly.
import { readFileSync } from 'fs';
import { HDKey } from '@scure/bip32';
import { mnemonicToSeedSync } from '@scure/bip39';
import { schnorr } from '@noble/curves/secp256k1';
import { tweakXOnlyPub, decodeBech32m } from '../src/lib/pearl.js';

const vecs = JSON.parse(readFileSync('/tmp/pearl-vectors.json', 'utf8'));
const seed = mnemonicToSeedSync('abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about');
const root = HDKey.fromMasterSeed(seed);
const child = root.derive("m/86'/808276'/0'/0/0");
const xonly = schnorr.getPublicKey(child.privateKey);

const { tweakedX, t } = tweakXOnlyPub(xonly);
console.log('JS tweaked:', Buffer.from(tweakedX).toString('hex'));
console.log('GO tweaked:', vecs.addresses[0].tweakedPub);
console.log('tweak t  :', Buffer.from(t).toString('hex'));

// decode GO address payload and compare
const dec = decodeBech32m(vecs.addresses[0].address);
console.log('GO addr payload:', Buffer.from(dec.program).toString('hex'), 'ver', dec.version);
