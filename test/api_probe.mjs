// Inspect CURVE.n on this noble version
import { schnorr } from '@noble/curves/secp256k1';
console.log('Point:', typeof schnorr.Point);
console.log('Point.CURVE:', typeof schnorr.Point?.CURVE);
console.log('CURVE keys:', schnorr.Point?.CURVE ? Object.keys(schnorr.Point.CURVE) : 'n/a');
if (schnorr.Point?.CURVE) console.log('n =', schnorr.Point.CURVE.n, typeof schnorr.Point.CURVE.n);
// maybe secp256k1.CURVE
import { secp256k1 } from '@noble/curves/secp256k1';
console.log('secp256k1.CURVE.n:', secp256k1.CURVE?.n, typeof secp256k1.CURVE?.n);
