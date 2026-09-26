// Diagnose remaining sig gap: my signing pipeline vs Go, per component
import { readFileSync } from 'fs';
import { HDKey } from '@scure/bip32';
import { mnemonicToSeedSync } from '@scure/bip39';
import { schnorr } from '@noble/curves/secp256k1';
import { derivePriv, tweakPriv, taggedHash } from '../src/lib/pearl.js';

const vecs = JSON.parse(readFileSync('/tmp/pearl-vectors.json', 'utf8'));
const seed = mnemonicToSeedSync('abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about');
const root = HDKey.fromMasterSeed(seed);
const priv0 = derivePriv(root, 0);
const x0 = schnorr.getPublicKey(priv0);

// 1. tweaked priv
const tweaked = tweakPriv(priv0, x0);
console.log('tweaked priv:', Buffer.from(tweaked).toString('hex'));

// 2. sign the GO digest with aux=0 and compare to GO sig
const goDigest = '0765e3bfbcbcac2d33096993db33588b0853955093d6ef1a37853c82b9afbc24';
const goSig = vecs.txs[0].signature;
const mine = schnorr.sign(Buffer.from(goDigest, 'hex'), tweaked, new Uint8Array(32));
console.log('mine over GO digest:', Buffer.from(mine).toString('hex').slice(0, 40));
console.log('GO sig            :', goSig.slice(0, 40));
console.log('match:', Buffer.from(mine).toString('hex') === goSig);

// 3. does GO sig verify against my tweaked pub?
const tweakedPub = schnorr.getPublicKey(tweaked);
console.log('verify GO sig w/ my tweaked pub:', schnorr.verify(Buffer.from(goSig, 'hex'), Buffer.from(goDigest, 'hex'), tweakedPub));
