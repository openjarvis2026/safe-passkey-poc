import { keccak256, encodeAbiParameters, toHex, pad, concat, type Hex } from 'viem';

// EIP-712 type hashes
export const SAFE_TX_TYPEHASH = keccak256(
  toHex(new TextEncoder().encode(
    'SafeTx(address to,uint256 value,bytes data,uint8 operation,uint256 safeTxGas,uint256 baseGas,uint256 gasPrice,address gasToken,address refundReceiver,uint256 nonce)'
  ))
);

const DOMAIN_SEPARATOR_TYPEHASH = keccak256(
  toHex(new TextEncoder().encode(
    'EIP712Domain(uint256 chainId,address verifyingContract)'
  ))
);

export function computeDomainSeparator(chainId: bigint, safeAddress: `0x${string}`): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: 'bytes32' }, { type: 'uint256' }, { type: 'address' }],
      [DOMAIN_SEPARATOR_TYPEHASH, chainId, safeAddress]
    )
  );
}

export function computeSafeTxHash(
  safeAddress: `0x${string}`,
  to: `0x${string}`,
  value: bigint,
  data: Hex,
  nonce: bigint
): Hex {
  const domainSeparator = computeDomainSeparator(84532n, safeAddress);

  const safeTxHash = keccak256(
    encodeAbiParameters(
      [
        { type: 'bytes32' },
        { type: 'address' },
        { type: 'uint256' },
        { type: 'bytes32' },
        { type: 'uint8' },
        { type: 'uint256' },
        { type: 'uint256' },
        { type: 'uint256' },
        { type: 'address' },
        { type: 'address' },
        { type: 'uint256' },
      ],
      [
        SAFE_TX_TYPEHASH,
        to,
        value,
        keccak256(data),
        0,    // operation (CALL)
        0n,   // safeTxGas
        0n,   // baseGas
        0n,   // gasPrice
        '0x0000000000000000000000000000000000000000',
        '0x0000000000000000000000000000000000000000',
        nonce,
      ]
    )
  );

  return keccak256(
    concat(['0x1901', domainSeparator, safeTxHash])
  );
}

export function packSafeSignature(
  signerAddress: `0x${string}`,
  authenticatorData: Uint8Array,
  clientDataJSON: string,
  challengeOffset: number,
  r: bigint,
  s: bigint
): Hex {
  // The Safe WebAuthn module v0.2.1 expects:
  //   (bytes authenticatorData, bytes clientDataFields, uint256[2] rs)
  // where clientDataFields is the portion of clientDataJSON AFTER the challenge value.
  // The contract reconstructs the full JSON as:
  //   {"type":"webauthn.get","challenge":"<base64url(hash)>",<clientDataFields>}
  //
  // Given clientDataJSON like:
  //   {"type":"webauthn.get","challenge":"ABC123","origin":"https://...","crossOrigin":false}
  // clientDataFields should be:
  //   "origin":"https://...","crossOrigin":false

  // Find the end of the challenge value (closing quote after challengeOffset)
  const challengeEnd = clientDataJSON.indexOf('"', challengeOffset);
  // Skip '","' to get to the fields after challenge
  const clientDataFields = clientDataJSON.slice(challengeEnd + 2, clientDataJSON.length - 1);
  const clientDataFieldsBytes = new TextEncoder().encode(clientDataFields);

  const webauthnSig = encodeAbiParameters(
    [
      { type: 'bytes' },      // authenticatorData
      { type: 'bytes' },      // clientDataFields
      { type: 'uint256[2]' }, // [r, s]
    ],
    [
      toHex(authenticatorData),
      toHex(clientDataFieldsBytes),
      [r, s],
    ]
  );

  const webauthnSigLength = (webauthnSig.length - 2) / 2; // bytes length

  // Static part (65 bytes):
  // 32 bytes: signer address padded
  // 32 bytes: offset = 65
  // 1 byte: signature type = 0x00 (contract signature)
  const staticPart = concat([
    pad(signerAddress, { size: 32 }),
    pad(toHex(65n), { size: 32 }),
    '0x00',
  ]);

  // Dynamic part:
  // 32 bytes: length of webauthn sig bytes
  const dynamicPart = concat([
    pad(toHex(BigInt(webauthnSigLength)), { size: 32 }),
    webauthnSig,
  ]);

  return concat([staticPart, dynamicPart]);
}

export function packLedgerSignature(
  signerAddress: `0x${string}`,
  r: string,
  s: string,
  v: number
): Hex {
  // For ECDSA signatures (Ledger), Safe expects:
  // Static part (65 bytes):
  //   32 bytes: signer address (padded)
  //   32 bytes: offset = 65
  //   1 byte: signature type = 0x01 (EOA signature)
  // Dynamic part:
  //   32 bytes: signature length = 65
  //   65 bytes: signature data (r+s+v)

  // Ensure r and s have 0x prefix
  const rHex = r.startsWith('0x') ? r : `0x${r}`;
  const sHex = s.startsWith('0x') ? s : `0x${s}`;
  
  // Pack signature: r (32) + s (32) + v (1) = 65 bytes
  const signature = concat([
    pad(rHex as Hex, { size: 32 }),
    pad(sHex as Hex, { size: 32 }),
    pad(toHex(v), { size: 1 }),
  ]);

  const staticPart = concat([
    pad(signerAddress, { size: 32 }),
    pad(toHex(65n), { size: 32 }),
    '0x01', // EOA signature type
  ]);

  const dynamicPart = concat([
    pad(toHex(65n), { size: 32 }), // signature length
    signature,
  ]);

  return concat([staticPart, dynamicPart]);
}
