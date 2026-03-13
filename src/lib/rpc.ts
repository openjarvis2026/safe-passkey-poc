/**
 * RPC fallback helper (R-1).
 *
 * Creates a viem `fallback` transport that rotates through multiple
 * RPC endpoints on failure.
 */

import { fallback, http } from 'viem';

const ENV_RPC = import.meta.env.VITE_CHAIN_RPC_URL as string | undefined;

/** Ordered list of Base Sepolia RPC endpoints. */
export const BASE_SEPOLIA_RPCS: string[] = [
  // Primary — env override or default
  ENV_RPC ?? 'https://sepolia.base.org',
  // Fallbacks
  'https://base-sepolia-rpc.publicnode.com',
  'https://sepolia.base.org',
  'https://base-sepolia.blockpi.network/v1/rpc/public',
].filter((url, i, arr) => arr.indexOf(url) === i); // dedupe

/**
 * A viem `fallback` transport that tries each RPC in order.
 * `retryCount: 1` per-url keeps total latency reasonable.
 */
export function resilientTransport() {
  return fallback(
    BASE_SEPOLIA_RPCS.map(url => http(url, { retryCount: 1, timeout: 10_000 })),
  );
}
