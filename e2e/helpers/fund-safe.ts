import { createWalletClient, http, parseEther } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { baseSepolia } from 'viem/chains';

/**
 * Fund a Safe address with ETH from the relayer account.
 * Uses the same relayer private key configured in the app's .env.
 */
export async function fundSafe(safeAddress: string, amount = '0.001') {
  const privateKey = process.env.VITE_RELAYER_PRIVATE_KEY;
  if (!privateKey) {
    throw new Error('VITE_RELAYER_PRIVATE_KEY not set in environment');
  }

  const account = privateKeyToAccount(privateKey as `0x${string}`);
  const client = createWalletClient({
    account,
    chain: baseSepolia,
    transport: http(),
  });

  const hash = await client.sendTransaction({
    to: safeAddress as `0x${string}`,
    value: parseEther(amount),
  });

  return hash;
}
