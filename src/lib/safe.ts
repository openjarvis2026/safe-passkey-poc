import { encodeFunctionData, type Hex } from 'viem';
import { walletClient, publicClient } from './relayer';

// Safe deployment addresses (v1.4.1, Base Sepolia)
const SAFE_SINGLETON = '0x41675C099F32341bf84BFc5382aF534df5C7461a' as const;
const SAFE_PROXY_FACTORY = '0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67' as const;
const COMPATIBILITY_FALLBACK_HANDLER = '0xfd0732Dc9E303f09fCEf3a7388Ad10A83459Ec99' as const;

const SAFE_ABI = [
  {
    name: 'setup',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: '_owners', type: 'address[]' },
      { name: '_threshold', type: 'uint256' },
      { name: 'to', type: 'address' },
      { name: 'data', type: 'bytes' },
      { name: 'fallbackHandler', type: 'address' },
      { name: 'paymentToken', type: 'address' },
      { name: 'payment', type: 'uint256' },
      { name: 'paymentReceiver', type: 'address' },
    ],
    outputs: [],
  },
  {
    name: 'execTransaction',
    type: 'function',
    stateMutability: 'payable',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'value', type: 'uint256' },
      { name: 'data', type: 'bytes' },
      { name: 'operation', type: 'uint8' },
      { name: 'safeTxGas', type: 'uint256' },
      { name: 'baseGas', type: 'uint256' },
      { name: 'gasPrice', type: 'uint256' },
      { name: 'gasToken', type: 'address' },
      { name: 'refundReceiver', type: 'address' },
      { name: 'signatures', type: 'bytes' },
    ],
    outputs: [{ name: 'success', type: 'bool' }],
  },
  {
    name: 'nonce',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'getOwners',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address[]' }],
  },
  {
    name: 'getThreshold',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'addOwnerWithThreshold',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: '_threshold', type: 'uint256' },
    ],
    outputs: [],
  },
  {
    name: 'swapOwner',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'prevOwner', type: 'address' },
      { name: 'oldOwner', type: 'address' },
      { name: 'newOwner', type: 'address' },
    ],
    outputs: [],
  },
  {
    name: 'changeThreshold',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: '_threshold', type: 'uint256' },
    ],
    outputs: [],
  },
] as const;

const PROXY_FACTORY_ABI = [
  {
    name: 'createProxyWithNonce',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: '_singleton', type: 'address' },
      { name: 'initializer', type: 'bytes' },
      { name: 'saltNonce', type: 'uint256' },
    ],
    outputs: [{ name: 'proxy', type: 'address' }],
  },
] as const;

export async function deploySafe(signerAddress: `0x${string}`): Promise<{ txHash: `0x${string}`; safeAddress: `0x${string}` }> {
  const ZERO = '0x0000000000000000000000000000000000000000' as const;

  const initializer = encodeFunctionData({
    abi: SAFE_ABI,
    functionName: 'setup',
    args: [
      [signerAddress],    // owners
      1n,                 // threshold
      ZERO,               // to (no delegate call)
      '0x',               // data
      COMPATIBILITY_FALLBACK_HANDLER,
      ZERO,               // paymentToken
      0n,                 // payment
      ZERO,               // paymentReceiver
    ],
  });

  const saltNonce = BigInt(Date.now());

  const txHash = await walletClient.writeContract({
    address: SAFE_PROXY_FACTORY,
    abi: PROXY_FACTORY_ABI,
    functionName: 'createProxyWithNonce',
    args: [SAFE_SINGLETON, initializer, saltNonce],
    gas: 500_000n,
  });

  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

  // Parse ProxyCreation event to get Safe address
  // event ProxyCreation(address indexed proxy, address singleton)
  const proxyCreationLog = receipt.logs.find(
    (log) => log.topics[0] === '0x4f51faf6c4561ff95f067657e43439f0f856d97c04d9ec9070a6199ad418e235'
  );

  let safeAddress: `0x${string}`;
  if (proxyCreationLog && proxyCreationLog.topics[1]) {
    safeAddress = `0x${proxyCreationLog.topics[1].slice(26)}` as `0x${string}`;
  } else {
    throw new Error('Could not find ProxyCreation event');
  }

  return { txHash, safeAddress };
}

export async function getNonce(safeAddress: `0x${string}`): Promise<bigint> {
  return publicClient.readContract({
    address: safeAddress,
    abi: SAFE_ABI,
    functionName: 'nonce',
  });
}

export async function execTransaction(
  safeAddress: `0x${string}`,
  to: `0x${string}`,
  value: bigint,
  data: Hex,
  signatures: Hex,
  operation: number = 0
): Promise<`0x${string}`> {
  const ZERO = '0x0000000000000000000000000000000000000000' as const;

  const txHash = await walletClient.writeContract({
    address: safeAddress,
    abi: SAFE_ABI,
    functionName: 'execTransaction',
    args: [to, value, data, operation, 0n, 0n, 0n, ZERO, ZERO, signatures],
    gas: 500_000n,
  });

  await publicClient.waitForTransactionReceipt({ hash: txHash });
  return txHash;
}

export async function getOwners(safeAddress: `0x${string}`): Promise<`0x${string}`[]> {
  const owners = await publicClient.readContract({
    address: safeAddress,
    abi: SAFE_ABI,
    functionName: 'getOwners',
  });
  return owners as `0x${string}`[];
}

export async function getThreshold(safeAddress: `0x${string}`): Promise<bigint> {
  return publicClient.readContract({
    address: safeAddress,
    abi: SAFE_ABI,
    functionName: 'getThreshold',
  });
}

export function encodeAddOwnerWithThreshold(
  owner: `0x${string}`,
  threshold: bigint
): Hex {
  return encodeFunctionData({
    abi: SAFE_ABI,
    functionName: 'addOwnerWithThreshold',
    args: [owner, threshold],
  });
}

// ERC-20 transfer function encoding
const ERC20_TRANSFER_ABI = [
  {
    name: 'transfer',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
] as const;

export function encodeERC20Transfer(
  to: `0x${string}`,
  amount: bigint
): Hex {
  return encodeFunctionData({
    abi: ERC20_TRANSFER_ABI,
    functionName: 'transfer',
    args: [to, amount],
  });
}

export function encodeSwapOwner(
  prevOwner: `0x${string}`,
  oldOwner: `0x${string}`,
  newOwner: `0x${string}`
): Hex {
  return encodeFunctionData({
    abi: SAFE_ABI,
    functionName: 'swapOwner',
    args: [prevOwner, oldOwner, newOwner],
  });
}

export function encodeChangeThreshold(
  newThreshold: bigint
): Hex {
  return encodeFunctionData({
    abi: SAFE_ABI,
    functionName: 'changeThreshold',
    args: [newThreshold],
  });
}
