// Multi-signature packing and shareable transaction blob handling
import { encodeAbiParameters, toHex, pad, concat, type Hex } from 'viem';

export interface ShareableTransaction {
  safe: string;
  to: string;
  value: string;
  data: string;
  nonce: string;
  chainId: number;
  signatures: Array<{
    signer: string;
    data: string; // packed EIP-1271 sig for this signer (hex)
  }>;
  threshold: number;
}

export interface SignatureComponents {
  signer: `0x${string}`;
  authenticatorData: Uint8Array;
  clientDataFields: string;
  r: bigint;
  s: bigint;
}

/**
 * Pack multiple EIP-1271 contract signatures for Safe's checkNSignatures.
 * Signatures MUST be sorted by signer address ascending.
 */
export function packMultiSignature(
  signatures: SignatureComponents[]
): Hex {
  const sorted = [...signatures].sort((a, b) =>
    a.signer.toLowerCase() < b.signer.toLowerCase() ? -1 : 1
  );

  const staticSize = sorted.length * 65;

  const encoded = sorted.map((s) => {
    const webauthnSig = encodeAbiParameters(
      [{ type: 'bytes' }, { type: 'bytes' }, { type: 'uint256[2]' }],
      [
        toHex(s.authenticatorData),
        toHex(new TextEncoder().encode(s.clientDataFields)),
        [s.r, s.s],
      ]
    );
    return { ...s, webauthnSig, byteLen: (webauthnSig.length - 2) / 2 };
  });

  let offset = staticSize;
  const offsets = encoded.map((e) => {
    const o = offset;
    offset += 32 + e.byteLen;
    return o;
  });

  const staticParts = encoded.map((e, i) =>
    concat([
      pad(e.signer, { size: 32 }),
      pad(toHex(BigInt(offsets[i])), { size: 32 }),
      '0x00',
    ])
  );

  const dynamicParts = encoded.map((e) =>
    concat([
      pad(toHex(BigInt(e.byteLen)), { size: 32 }),
      e.webauthnSig,
    ])
  );

  return concat([...staticParts, ...dynamicParts]);
}

/**
 * Encode a single signer's signature as a standalone packed EIP-1271 sig.
 * Used for individual signing before combining.
 */
export function packSingleSignerData(
  authenticatorData: Uint8Array,
  clientDataFields: string,
  r: bigint,
  s: bigint
): Hex {
  return encodeAbiParameters(
    [{ type: 'bytes' }, { type: 'bytes' }, { type: 'uint256[2]' }],
    [
      toHex(authenticatorData),
      toHex(new TextEncoder().encode(clientDataFields)),
      [r, s],
    ]
  );
}

// base64url encode/decode
export function toBase64Url(str: string): string {
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64Url(b64: string): string {
  let s = b64.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  return atob(s);
}

export function encodeShareableTransaction(tx: ShareableTransaction): string {
  return toBase64Url(JSON.stringify(tx));
}

export function decodeShareableTransaction(encoded: string): ShareableTransaction {
  return JSON.parse(fromBase64Url(encoded));
}

/**
 * Build packed multi-sig from ShareableTransaction's individual signer data.
 * Each sig.data is the webauthn ABI-encoded signature for that signer.
 * We rebuild the full contract-sig packing (static + dynamic parts, sorted).
 */
export function packFromShareable(
  sigs: Array<{ signer: string; data: string }>
): Hex {
  const sorted = [...sigs].sort((a, b) =>
    a.signer.toLowerCase() < b.signer.toLowerCase() ? -1 : 1
  );

  const staticSize = sorted.length * 65;

  const encoded = sorted.map((s) => {
    const byteLen = (s.data.length - 2) / 2;
    return { signer: s.signer as `0x${string}`, webauthnSig: s.data as Hex, byteLen };
  });

  let offset = staticSize;
  const offsets = encoded.map((e) => {
    const o = offset;
    offset += 32 + e.byteLen;
    return o;
  });

  const staticParts = encoded.map((e, i) =>
    concat([
      pad(e.signer, { size: 32 }),
      pad(toHex(BigInt(offsets[i])), { size: 32 }),
      '0x00',
    ])
  );

  const dynamicParts = encoded.map((e) =>
    concat([
      pad(toHex(BigInt(e.byteLen)), { size: 32 }),
      e.webauthnSig,
    ])
  );

  return concat([...staticParts, ...dynamicParts]);
}
