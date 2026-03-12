import { decode } from 'cbor-x';

export interface PasskeyCredential {
  rawId: ArrayBuffer;
  publicKey: { x: bigint; y: bigint };
}

export async function createPasskey(): Promise<PasskeyCredential> {
  const challenge = crypto.getRandomValues(new Uint8Array(32));

  const credential = (await navigator.credentials.create({
    publicKey: {
      rp: { name: 'Safe Passkey PoC' },
      user: {
        id: crypto.getRandomValues(new Uint8Array(16)),
        name: 'safe-owner',
        displayName: 'Safe Owner',
      },
      challenge,
      pubKeyCredParams: [{ alg: -7, type: 'public-key' }], // ES256 (P-256)
      authenticatorSelection: {
        authenticatorAttachment: 'platform',
        residentKey: 'preferred',
        userVerification: 'required',
      },
      attestation: 'direct',
    },
  })) as PublicKeyCredential;

  if (!credential) throw new Error('Passkey creation cancelled');

  const response = credential.response as AuthenticatorAttestationResponse;
  const publicKey = parsePublicKey(response.attestationObject);

  return { rawId: credential.rawId, publicKey };
}

function parsePublicKey(attestationObject: ArrayBuffer): { x: bigint; y: bigint } {
  const decoded = decode(new Uint8Array(attestationObject));
  const authData = new Uint8Array(decoded.authData);

  // authData: 32 bytes rpIdHash + 1 byte flags + 4 bytes counter + variable attestedCredData
  const credDataOffset = 37;
  // attestedCredData: 16 bytes aaguid + 2 bytes credIdLen + credId + publicKey CBOR
  const credIdLen = (authData[credDataOffset + 16] << 8) | authData[credDataOffset + 17];
  const publicKeyOffset = credDataOffset + 18 + credIdLen;

  const publicKeyCbor = decode(authData.slice(publicKeyOffset));
  // COSE key: -2 (0x21) = x, -3 (0x22) = y
  const x = publicKeyCbor.get(-2) as Uint8Array;
  const y = publicKeyCbor.get(-3) as Uint8Array;

  return {
    x: bytesToBigInt(x),
    y: bytesToBigInt(y),
  };
}

export interface WebAuthnSignatureData {
  authenticatorData: Uint8Array;
  clientDataJSON: string;
  r: bigint;
  s: bigint;
  challengeOffset: number;
}

export async function signWithPasskey(
  rawId: ArrayBuffer,
  challenge: Uint8Array
): Promise<WebAuthnSignatureData> {
  const credential = (await navigator.credentials.get({
    publicKey: {
      challenge: challenge as BufferSource,
      allowCredentials: [{ id: rawId, type: 'public-key' as const }],
      userVerification: 'required',
    },
  })) as PublicKeyCredential;

  if (!credential) throw new Error('Signing cancelled');

  const response = credential.response as AuthenticatorAssertionResponse;
  const authenticatorData = new Uint8Array(response.authenticatorData);
  const clientDataJSON = new TextDecoder().decode(response.clientDataJSON);
  const { r, s } = parseDER(new Uint8Array(response.signature));

  // Low-S normalization (CRITICAL)
  const P256_N = 0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551n;
  const normalizedS = s > P256_N / 2n ? P256_N - s : s;

  const challengeOffset =
    clientDataJSON.indexOf('"challenge":"') + '"challenge":"'.length;

  return {
    authenticatorData,
    clientDataJSON,
    r,
    s: normalizedS,
    challengeOffset,
  };
}

function parseDER(sig: Uint8Array): { r: bigint; s: bigint } {
  // 0x30 [len] 0x02 [rLen] [r...] 0x02 [sLen] [s...]
  let offset = 2; // skip SEQUENCE tag + length
  if (sig[offset] !== 0x02) throw new Error('Expected INTEGER tag for r');
  offset++;
  const rLen = sig[offset++];
  let rBytes = sig.slice(offset, offset + rLen);
  // Strip leading 0x00 padding
  if (rBytes[0] === 0x00) rBytes = rBytes.slice(1);
  offset += rLen;

  if (sig[offset] !== 0x02) throw new Error('Expected INTEGER tag for s');
  offset++;
  const sLen = sig[offset++];
  let sBytes = sig.slice(offset, offset + sLen);
  if (sBytes[0] === 0x00) sBytes = sBytes.slice(1);

  return { r: bytesToBigInt(rBytes), s: bytesToBigInt(sBytes) };
}

function bytesToBigInt(bytes: Uint8Array): bigint {
  let hex = '0x';
  for (const b of bytes) hex += b.toString(16).padStart(2, '0');
  return BigInt(hex);
}
