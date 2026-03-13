import { createWalletClient, createPublicClient, http } from 'viem';
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
