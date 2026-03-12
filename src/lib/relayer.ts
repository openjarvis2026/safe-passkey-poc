import { createWalletClient, createPublicClient, http, type Chain } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

export const baseSepolia: Chain = {
  id: 84532,
  name: 'Base Sepolia',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: ['https://sepolia.base.org'] } },
  blockExplorers: { default: { name: 'BaseScan', url: 'https://sepolia.basescan.org' } },
};

const privateKey = import.meta.env.VITE_RELAYER_PRIVATE_KEY as `0x${string}`;
if (!privateKey) throw new Error('VITE_RELAYER_PRIVATE_KEY not set');

export const relayerAccount = privateKeyToAccount(privateKey);

export const walletClient = createWalletClient({
  account: relayerAccount,
  chain: baseSepolia,
  transport: http(),
});

export const publicClient = createPublicClient({
  chain: baseSepolia,
  transport: http(),
});

export const EXPLORER = 'https://sepolia.basescan.org';
