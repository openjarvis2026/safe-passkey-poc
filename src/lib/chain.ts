import { type Chain } from 'viem';
import { baseSepolia as viemBaseSepolia } from 'viem/chains';

/**
 * Chain configuration — reads from environment variables.
 * 
 * To use a custom chain, set ALL of these in .env:
 *   VITE_CHAIN_ID=8453
 *   VITE_CHAIN_RPC_URL=https://your-rpc.example.com
 *   VITE_CHAIN_NAME=My Chain
 *   VITE_EXPLORER_URL=https://explorer.example.com
 * 
 * Defaults to Base Sepolia if VITE_CHAIN_ID is not set.
 */

const envChainId = import.meta.env.VITE_CHAIN_ID
  ? Number(import.meta.env.VITE_CHAIN_ID)
  : undefined;

// Only use custom RPC if a custom chain ID is also set
// This prevents accidentally using a non-Base-Sepolia RPC with Base Sepolia contracts
const useCustomChain = envChainId !== undefined;
const envRpcUrl = useCustomChain ? (import.meta.env.VITE_CHAIN_RPC_URL as string | undefined) : undefined;
const envChainName = useCustomChain ? (import.meta.env.VITE_CHAIN_NAME as string | undefined) : undefined;
const envExplorerUrl = useCustomChain ? (import.meta.env.VITE_EXPLORER_URL as string | undefined) : undefined;

const BASE_SEPOLIA_RPC = 'https://sepolia.base.org';

// Default: Base Sepolia
const defaultChain: Chain = {
  ...viemBaseSepolia,
  rpcUrls: {
    default: { http: [BASE_SEPOLIA_RPC] },
  },
};

export const chain: Chain = useCustomChain
  ? {
      id: envChainId!,
      name: envChainName ?? `Chain ${envChainId}`,
      nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
      rpcUrls: {
        default: { http: [envRpcUrl ?? BASE_SEPOLIA_RPC] },
      },
      ...(envExplorerUrl
        ? { blockExplorers: { default: { name: 'Explorer', url: envExplorerUrl } } }
        : {}),
      contracts: {
        multicall3: {
          address: '0xca11bde05977b3631167028862be2a173976ca11' as `0x${string}`,
        },
      },
    }
  : defaultChain;

export const CHAIN_ID = chain.id;
export const CHAIN_ID_BIGINT = BigInt(chain.id);
export const EXPLORER = envExplorerUrl ?? 'https://sepolia.basescan.org';
