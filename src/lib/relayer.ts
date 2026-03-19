import { createWalletClient, createPublicClient, http, type WriteContractParameters } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { chain, EXPLORER } from './chain';
import { resilientTransport } from './rpc';

export { chain, EXPLORER };

const privateKey = import.meta.env.VITE_RELAYER_PRIVATE_KEY as `0x${string}`;
if (!privateKey) throw new Error('VITE_RELAYER_PRIVATE_KEY not set');

export const relayerAccount = privateKeyToAccount(privateKey);

export const walletClient = createWalletClient({
  account: relayerAccount,
  chain,
  transport: http(),
});

export const publicClient = createPublicClient({
  chain,
  transport: http(),
});

/**
 * Fetch the current relayer nonce from the chain, including pending transactions.
 * Using 'pending' ensures we account for any in-flight txs in the mempool.
 */
export async function getRelayerNonce(): Promise<number> {
  const nonce = await publicClient.getTransactionCount({
    address: relayerAccount.address,
    blockTag: 'pending',
  });
  console.log(`[relayer] Current nonce for ${relayerAccount.address}: ${nonce}`);
  return nonce;
}

const MAX_NONCE_RETRIES = 3;

/**
 * Submit a writeContract call with explicit nonce fetched fresh from the chain.
 * Retries automatically on "nonce too low" errors, re-fetching the nonce each time.
 */
export async function writeContractWithNonce(
  params: Omit<WriteContractParameters, 'account' | 'chain' | 'nonce'>
): Promise<`0x${string}`> {
  for (let attempt = 0; attempt <= MAX_NONCE_RETRIES; attempt++) {
    const nonce = await getRelayerNonce();
    console.log(`[relayer] Submitting tx (attempt ${attempt + 1}), nonce=${nonce}`);
    try {
      const hash = await walletClient.writeContract({
        ...params,
        account: relayerAccount,
        chain,
        nonce,
      } as WriteContractParameters);
      console.log(`[relayer] Tx submitted: ${hash}, nonce=${nonce}`);
      return hash;
    } catch (err: any) {
      const msg: string = err?.message ?? String(err);
      const isNonceTooLow =
        msg.includes('nonce too low') ||
        msg.includes('nonce has already been used') ||
        msg.includes('replacement transaction underpriced') ||
        msg.includes('already known');

      if (isNonceTooLow && attempt < MAX_NONCE_RETRIES) {
        console.warn(`[relayer] Nonce too low (expected ${nonce}), retrying (${attempt + 1}/${MAX_NONCE_RETRIES})…`);
        // Small back-off before re-querying the chain
        await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
        continue;
      }
      throw err;
    }
  }
  // TypeScript: unreachable, but keeps the compiler happy
  throw new Error('[relayer] Exceeded max nonce retries');
}
