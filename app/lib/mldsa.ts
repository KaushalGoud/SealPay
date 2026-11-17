import { ml_dsa44 } from "@noble/post-quantum/ml-dsa.js";
import { bytesToHex, hexToBytes, type Hex } from "viem";

export type VendorKey = {
  publicKey: Hex;
  secretKey: Hex;
};

export function generateVendorKey(): VendorKey {
  const seed = new Uint8Array(32);
  crypto.getRandomValues(seed);
  const { publicKey, secretKey } = ml_dsa44.keygen(seed);
  return { publicKey: bytesToHex(publicKey), secretKey: bytesToHex(secretKey) };
}

export function signDigest(digest: Hex, secretKey: Hex): Hex {
  return bytesToHex(ml_dsa44.sign(hexToBytes(digest), hexToBytes(secretKey)));
}

export function verifyDigest(digest: Hex, signature: Hex, publicKey: Hex): boolean {
  try {
    return ml_dsa44.verify(hexToBytes(signature), hexToBytes(digest), hexToBytes(publicKey));
  } catch {
    return false;
  }
}

export const ML_DSA_44_PUBLIC_KEY_BYTES = 1312;
export const ML_DSA_44_SIGNATURE_BYTES = 2420;
