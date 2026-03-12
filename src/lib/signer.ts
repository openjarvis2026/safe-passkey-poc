import { walletClient, publicClient } from './relayer';

// SafeWebAuthnSignerFactory (CREATE2, same on all chains)
const SIGNER_FACTORY = '0x1d31F259eE307358a26dFb23EB365939E8641195' as const;
// DaimoP256Verifier
const P256_VERIFIER = '0xc2b78104907F722DABAc4C69f826a522B2754De4' as const;

// On Base Sepolia, EIP-7212 precompile is at 0x100. We pack verifiers as:
// uint176 = (p256Verifier address) | (precompile address shifted or just verifier)
// The SafeWebAuthnSignerFactory expects uint176 verifiers where:
// lower 160 bits = fallback verifier, upper 16 bits = precompile flag
// For EIP-7212 native chains, we can just pass the verifier address
const VERIFIERS = BigInt(P256_VERIFIER);

const FACTORY_ABI = [
  {
    name: 'getSigner',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'x', type: 'uint256' },
      { name: 'y', type: 'uint256' },
      { name: 'verifiers', type: 'uint176' },
    ],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    name: 'createSigner',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'x', type: 'uint256' },
      { name: 'y', type: 'uint256' },
      { name: 'verifiers', type: 'uint176' },
    ],
    outputs: [{ name: '', type: 'address' }],
  },
] as const;

export async function getSignerAddress(x: bigint, y: bigint): Promise<`0x${string}`> {
  return publicClient.readContract({
    address: SIGNER_FACTORY,
    abi: FACTORY_ABI,
    functionName: 'getSigner',
    args: [x, y, VERIFIERS],
  });
}

export async function deploySignerProxy(x: bigint, y: bigint): Promise<`0x${string}`> {
  const hash = await walletClient.writeContract({
    address: SIGNER_FACTORY,
    abi: FACTORY_ABI,
    functionName: 'createSigner',
    args: [x, y, VERIFIERS],
  });

  await publicClient.waitForTransactionReceipt({ hash });
  return hash;
}
