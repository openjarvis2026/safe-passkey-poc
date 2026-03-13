import { type Chain } from 'viem';
import { baseSepolia as viemBaseSepolia } from 'viem/chains';

/**
 * Chain configuration — reads from environment variables.
 * 
 * Set these in your .env to point at a different chain (e.g. CoBuilders Chain):
 *   VITE_CHAIN_ID=8453
 *   VITE_CHAIN_RPC_URL=https://cobuilders-chain-production.up.railway.app
 *   VITE_CHAIN_NAME=CoBuilders Chain
 *   VITE_EXPLORER_URL=  (leave empty if no explorer)
 * 
 * Defaults to Base Sepolia if not set.
 */

const envChainId = import.meta.env.VITE_CHAIN_ID
  ? Number(import.meta.env.VITE_CHAIN_ID)
  : undefined;

const envRpcUrl = import.meta.env.VITE_CHAIN_RPC_URL as string | undefined;
const envChainName = import.meta.env.VITE_CHAIN_NAME as string | undefined;
const envExplorerUrl = import.meta.env.VITE_EXPLORER_URL as string | undefined;

// Default: Base Sepolia
const defaultChain: Chain = {
  ...viemBaseSepolia,
  rpcUrls: {
    default: { http: [envRpcUrl ?? 'https://sepolia.base.org'] },
  },
};

export const chain: Chain = envChainId
  ? {
      id: envChainId,
      name: envChainName ?? `Chain ${envChainId}`,
      nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
      rpcUrls: {
        default: { http: [envRpcUrl ?? 'https://sepolia.base.org'] },
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
