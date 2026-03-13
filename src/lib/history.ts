import { getAddress } from 'viem';
import { type Token, findTokenByAddress, NATIVE_TOKEN, TOKENS } from './tokens';
import { publicClient } from './relayer';

// Normalized transaction interface
export interface SafeTransaction {
  txHash: string;
  type: 'send' | 'receive' | 'ownerChange' | 'unknown';
  to: `0x${string}`;
  from: `0x${string}`;
  amount: bigint;
  token: Token;
  timestamp: string; // ISO string
  status: 'confirmed' | 'pending' | 'failed';
  blockNumber?: number;
  safe: `0x${string}`;
  executionDate?: string;
}

// Safe Transaction Service API response types
interface SafeApiTransfer {
  type: 'ETHER_TRANSFER' | 'ERC20_TRANSFER';
  executionDate: string | null;
  blockNumber: number | null;
  transactionHash: string | null;
  to: string;
  from: string;
  value: string;
  tokenInfo?: {
    type: 'ERC20';
    address: string;
    name: string;
    symbol: string;
    decimals: number;
    logoUri?: string;
  };
}

interface SafeApiModuleTransaction {
  type: 'MODULE_TRANSACTION';
  created: string;
  executionDate: string | null;
  blockNumber: number | null;
  transactionHash: string | null;
  safe: string;
  module: string;
  to: string;
  value: string;
  data: string;
  operation: number;
  transfers: SafeApiTransfer[];
}

interface SafeApiMultisigTransaction {
  type: 'MULTISIG_TRANSACTION';
  safe: string;
  to: string;
  value: string;
  data: string;
  operation: number;
  gasToken: string | null;
  safeTxGas: number;
  baseGas: number;
  gasPrice: string;
  refundReceiver: string | null;
  nonce: number;
  executionDate: string | null;
  submissionDate: string;
  modified: string;
  blockNumber: number | null;
  transactionHash: string | null;
  safeTxHash: string;
  proposer: string | null;
  executor: string | null;
  isExecuted: boolean;
  isSuccessful: boolean | null;
  ethGasPrice: string | null;
  maxFeePerGas: string | null;
  maxPriorityFeePerGas: string | null;
  gasUsed: number | null;
  fee: string | null;
  origin: string | null;
  dataDecoded: any | null;
  confirmationsRequired: number;
  confirmations: Array<{
    owner: string;
    submissionDate: string;
    transactionHash: string | null;
    signature: string;
    signatureType: string;
  }>;
  trusted: boolean;
  signatures: string | null;
  transfers: SafeApiTransfer[];
}

interface SafeApiResponse {
  count: number;
  next: string | null;
  previous: string | null;
  results: Array<SafeApiModuleTransaction | SafeApiMultisigTransaction>;
}

// Incoming transfers API response type
interface SafeApiIncomingTransfer {
  type: 'ETHER_TRANSFER' | 'ERC20_TRANSFER';
  executionDate: string | null;
  blockNumber: number | null;
  transactionHash: string | null;
  to: string;
  from: string;
  value: string;
  tokenInfo?: {
    type: 'ERC20';
    address: string;
    name: string;
    symbol: string;
    decimals: number;
    logoUri?: string;
  };
}

interface SafeApiIncomingTransfersResponse {
  count: number;
  next: string | null;
  previous: string | null;
  results: SafeApiIncomingTransfer[];
}

// Detect transaction type based on Safe and transaction data
function detectTransactionType(
  tx: SafeApiModuleTransaction | SafeApiMultisigTransaction,
  safeAddress: `0x${string}`
): 'send' | 'receive' | 'ownerChange' | 'unknown' {
  const safe = safeAddress.toLowerCase();
  
  // Check if this is an owner management transaction
  if (tx.to.toLowerCase() === safe) {
    // Owner management transactions target the Safe itself
    if (tx.data && tx.data !== '0x') {
      // Check common owner management function selectors
      const selector = tx.data.slice(0, 10).toLowerCase();
      if (
        selector === '0x7de7edef' || // addOwnerWithThreshold
        selector === '0xf8dc5dd9' || // removeOwner
        selector === '0x694e80c3'    // swapOwner
      ) {
        return 'ownerChange';
      }
    }
  }

  // For transfers, use the first transfer to determine direction
  if (tx.transfers && tx.transfers.length > 0) {
    const firstTransfer = tx.transfers[0];
    const fromAddr = firstTransfer.from.toLowerCase();
    const toAddr = firstTransfer.to.toLowerCase();
    
    if (fromAddr === safe) {
      return 'send';
    } else if (toAddr === safe) {
      return 'receive';
    }
  }

  return 'unknown';
}

// Normalize an incoming transfer
function normalizeIncomingTransfer(
  transfer: SafeApiIncomingTransfer,
  safeAddress: `0x${string}`
): SafeTransaction | null {
  const txHash = transfer.transactionHash;
  if (!txHash) return null;

  let token = NATIVE_TOKEN;
  const amount = BigInt(transfer.value || '0');

  // Determine token
  if (transfer.type === 'ERC20_TRANSFER' && transfer.tokenInfo) {
    const foundToken = findTokenByAddress(transfer.tokenInfo.address as `0x${string}`);
    if (foundToken) {
      token = foundToken;
    } else {
      // Create token from API data if not in our list
      token = {
        address: transfer.tokenInfo.address as `0x${string}`,
        symbol: transfer.tokenInfo.symbol,
        name: transfer.tokenInfo.name,
        decimals: transfer.tokenInfo.decimals,
      };
    }
  }

  // Status is confirmed if we have execution date and block number
  const status: 'confirmed' | 'pending' | 'failed' = 
    transfer.executionDate && transfer.blockNumber ? 'confirmed' : 'pending';

  return {
    txHash,
    type: 'receive', // All incoming transfers are receives
    to: transfer.to as `0x${string}`,
    from: transfer.from as `0x${string}`,
    amount,
    token,
    timestamp: transfer.executionDate || new Date().toISOString(), // Fallback to now if no date
    status,
    blockNumber: transfer.blockNumber || undefined,
    safe: safeAddress,
    executionDate: transfer.executionDate || undefined,
  };
}

// Normalize a Safe API transaction
function normalizeTransaction(
  tx: SafeApiModuleTransaction | SafeApiMultisigTransaction,
  safeAddress: `0x${string}`
): SafeTransaction | null {
  const txHash = tx.transactionHash;
  if (!txHash) return null; // Skip transactions without hash

  const type = detectTransactionType(tx, safeAddress);
  let amount = BigInt(0);
  let token = NATIVE_TOKEN;
  let to = tx.to as `0x${string}`;
  let from = safeAddress;

  // For transfers, use the primary transfer data
  if (tx.transfers && tx.transfers.length > 0) {
    const transfer = tx.transfers[0];
    amount = BigInt(transfer.value || '0');
    to = transfer.to as `0x${string}`;
    from = transfer.from as `0x${string}`;
    
    // Determine token
    if (transfer.type === 'ERC20_TRANSFER' && transfer.tokenInfo) {
      const foundToken = findTokenByAddress(transfer.tokenInfo.address as `0x${string}`);
      if (foundToken) {
        token = foundToken;
      } else {
        // Create token from API data if not in our list
        token = {
          address: transfer.tokenInfo.address as `0x${string}`,
          symbol: transfer.tokenInfo.symbol,
          name: transfer.tokenInfo.name,
          decimals: transfer.tokenInfo.decimals,
        };
      }
    }
  } else {
    // Fallback to transaction value if no transfers
    amount = BigInt(tx.value || '0');
  }

  // Determine status
  let status: 'confirmed' | 'pending' | 'failed' = 'pending';
  if (tx.executionDate && tx.blockNumber) {
    if (tx.type === 'MULTISIG_TRANSACTION') {
      status = tx.isSuccessful !== false ? 'confirmed' : 'failed';
    } else {
      status = 'confirmed';
    }
  }

  // Use execution date or submission date
  const timestamp = tx.executionDate || 
    (tx.type === 'MULTISIG_TRANSACTION' ? tx.submissionDate : tx.created);

  return {
    txHash,
    type,
    to,
    from,
    amount,
    token,
    timestamp,
    status,
    blockNumber: tx.blockNumber || undefined,
    safe: safeAddress,
    executionDate: tx.executionDate || undefined,
  };
}

// Fetch transaction history from Safe Transaction Service API
export async function fetchTransactionHistory(
  safeAddress: `0x${string}`,
  limit = 50
): Promise<SafeTransaction[]> {
  try {
    // Ensure the Safe address is checksummed
    const checksummedAddress = getAddress(safeAddress);
    
    const baseUrl = 'https://safe-transaction-base-sepolia.safe.global';
    
    // Fetch all three transaction sources
    const [outgoingTxs, incomingTransfers, multisigTxs] = await Promise.allSettled([
      // Fetch outgoing transactions
      fetch(`${baseUrl}/api/v1/safes/${checksummedAddress}/all-transactions/?limit=${limit}`, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
        },
      }),
      // Fetch incoming transfers
      fetch(`${baseUrl}/api/v1/safes/${checksummedAddress}/incoming-transfers/?limit=${limit}`, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
        },
      }),
      // Fetch executed multisig transactions (specifically for outgoing transactions)
      fetch(`${baseUrl}/api/v1/safes/${checksummedAddress}/multisig-transactions/?limit=${limit}&executed=true`, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
        },
      })
    ]);

    const transactions: SafeTransaction[] = [];
    let hasData = false;

    // Process outgoing transactions
    if (outgoingTxs.status === 'fulfilled') {
      const response = outgoingTxs.value;
      if (response.ok) {
        const data: SafeApiResponse = await response.json();
        if (data.results.length > 0) {
          hasData = true;
          for (const tx of data.results) {
            const normalized = normalizeTransaction(tx, checksummedAddress);
            if (normalized) {
              transactions.push(normalized);
            }
          }
        }
      } else if (response.status !== 404 && response.status !== 422) {
        // Log non-404/422 errors but continue
        console.warn(`Error fetching outgoing transactions (${response.status}):`, response.statusText);
      }
    } else {
      console.warn('Failed to fetch outgoing transactions:', outgoingTxs.reason);
    }

    // Process incoming transfers
    if (incomingTransfers.status === 'fulfilled') {
      const response = incomingTransfers.value;
      if (response.ok) {
        const data: SafeApiIncomingTransfersResponse = await response.json();
        if (data.results.length > 0) {
          hasData = true;
          for (const transfer of data.results) {
            const normalized = normalizeIncomingTransfer(transfer, checksummedAddress);
            if (normalized) {
              transactions.push(normalized);
            }
          }
        }
      } else if (response.status !== 404 && response.status !== 422) {
        // Log non-404/422 errors but continue
        console.warn(`Error fetching incoming transfers (${response.status}):`, response.statusText);
      }
    } else {
      console.warn('Failed to fetch incoming transfers:', incomingTransfers.reason);
    }

    // Process executed multisig transactions
    if (multisigTxs.status === 'fulfilled') {
      const response = multisigTxs.value;
      if (response.ok) {
        const data: SafeApiResponse = await response.json();
        if (data.results.length > 0) {
          hasData = true;
          for (const tx of data.results) {
            const normalized = normalizeTransaction(tx, checksummedAddress);
            if (normalized) {
              transactions.push(normalized);
            }
          }
        }
      } else if (response.status !== 404 && response.status !== 422) {
        // Log non-404/422 errors but continue
        console.warn(`Error fetching multisig transactions (${response.status}):`, response.statusText);
      }
    } else {
      console.warn('Failed to fetch multisig transactions:', multisigTxs.reason);
    }

    // Always attempt on-chain fallback to supplement API results
    // The Safe Transaction Service is unreliable for custom-deployed Safes on Base Sepolia
    try {
      const onChainTxs = await fetchOnChainTransactions(checksummedAddress);
      transactions.push(...onChainTxs);
    } catch (err) {
      console.warn('On-chain fallback failed, using API results only:', err);
    }

    // Merge locally cached sent transactions (always reliable)
    const localTxs = getLocalTransactions(checksummedAddress);
    transactions.push(...localTxs);

    if (transactions.length === 0) {
      return [];
    }

    // Deduplicate by txHash (endpoints may have overlapping transactions)
    const seen = new Set<string>();
    const deduplicated = transactions.filter(tx => {
      if (seen.has(tx.txHash)) return false;
      seen.add(tx.txHash);
      return true;
    });

    // Sort by timestamp (newest first)
    return deduplicated.sort((a, b) => 
      new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );

  } catch (error) {
    console.error('Error fetching transaction history:', error);
    throw error;
  }
}

// ERC-20 Transfer event signature
const TRANSFER_EVENT_ABI = {
  type: 'event',
  name: 'Transfer',
  inputs: [
    { type: 'address', name: 'from', indexed: true },
    { type: 'address', name: 'to', indexed: true },
    { type: 'uint256', name: 'value', indexed: false },
  ],
} as const;

// Number of recent blocks to scan for on-chain events
const ON_CHAIN_BLOCK_RANGE = 2000n;

// Fetch transactions directly from on-chain Transfer events
async function fetchOnChainTransactions(
  safeAddress: `0x${string}`
): Promise<SafeTransaction[]> {
  const currentBlock = await publicClient.getBlockNumber();
  const fromBlock = currentBlock > ON_CHAIN_BLOCK_RANGE ? currentBlock - ON_CHAIN_BLOCK_RANGE : 0n;

  // Get ERC-20 token addresses (exclude native ETH)
  const erc20Tokens = TOKENS.filter(
    t => t.address !== '0x0000000000000000000000000000000000000000'
  );

  const transactions: SafeTransaction[] = [];

  // Fetch outgoing and incoming ERC-20 Transfer events in parallel
  const [outgoingLogs, incomingLogs] = await Promise.all([
    // Outgoing ERC-20: Transfer events where from = safe
    publicClient.getLogs({
      event: TRANSFER_EVENT_ABI,
      args: { from: safeAddress },
      address: erc20Tokens.map(t => t.address),
      fromBlock,
      toBlock: currentBlock,
    }),
    // Incoming ERC-20: Transfer events where to = safe
    publicClient.getLogs({
      event: TRANSFER_EVENT_ABI,
      args: { to: safeAddress },
      address: erc20Tokens.map(t => t.address),
      fromBlock,
      toBlock: currentBlock,
    }),
  ]);

  // Cache blocks for timestamp lookups
  const blockCache = new Map<bigint, bigint>();
  const getBlockTimestamp = async (blockNumber: bigint): Promise<bigint> => {
    const cached = blockCache.get(blockNumber);
    if (cached !== undefined) return cached;
    const block = await publicClient.getBlock({ blockNumber });
    blockCache.set(blockNumber, block.timestamp);
    return block.timestamp;
  };

  // Collect unique block numbers for batch timestamp fetching
  const allLogs = [...outgoingLogs, ...incomingLogs];
  const uniqueBlocks = [...new Set(allLogs.map(l => l.blockNumber))];
  await Promise.all(uniqueBlocks.map(bn => getBlockTimestamp(bn)));

  // Process outgoing ERC-20 transfers
  for (const log of outgoingLogs) {
    if (!log.transactionHash || !log.args.from || !log.args.to || log.args.value === undefined) continue;
    const token = findTokenByAddress(log.address as `0x${string}`);
    if (!token) continue;

    const ts = blockCache.get(log.blockNumber) ?? 0n;
    transactions.push({
      txHash: log.transactionHash,
      type: 'send',
      from: log.args.from as `0x${string}`,
      to: log.args.to as `0x${string}`,
      amount: log.args.value,
      token,
      timestamp: new Date(Number(ts) * 1000).toISOString(),
      status: 'confirmed',
      blockNumber: Number(log.blockNumber),
      safe: safeAddress,
      executionDate: new Date(Number(ts) * 1000).toISOString(),
    });
  }

  // Process incoming ERC-20 transfers
  for (const log of incomingLogs) {
    if (!log.transactionHash || !log.args.from || !log.args.to || log.args.value === undefined) continue;
    const token = findTokenByAddress(log.address as `0x${string}`);
    if (!token) continue;

    const ts = blockCache.get(log.blockNumber) ?? 0n;
    transactions.push({
      txHash: log.transactionHash,
      type: 'receive',
      from: log.args.from as `0x${string}`,
      to: log.args.to as `0x${string}`,
      amount: log.args.value,
      token,
      timestamp: new Date(Number(ts) * 1000).toISOString(),
      status: 'confirmed',
      blockNumber: Number(log.blockNumber),
      safe: safeAddress,
      executionDate: new Date(Number(ts) * 1000).toISOString(),
    });
  }

  // NOTE: Native ETH outgoing from a Safe can't be detected on-chain by scanning blocks
  // because the tx.from is the relayer (EOA), not the Safe (contract).
  // Native ETH leaves the Safe as an internal transaction within execTransaction().
  // We rely on localStorage cache (cacheLocalTransaction) for outgoing native ETH visibility.

  return transactions;
}

// ── Local transaction cache ──
// Safe Transaction Service is unreliable for custom-deployed Safes.
// We cache sent transactions in localStorage so they appear in history immediately.

const LOCAL_TX_KEY = 'simply_sent_transactions';

interface LocalTxRecord {
  txHash: string;
  safeAddress: string;
  to: string;
  amount: string; // stringified bigint
  token: Token;
  timestamp: string;
}

export function cacheLocalTransaction(
  safeAddress: `0x${string}`,
  txHash: string,
  to: `0x${string}`,
  amount: bigint,
  token: Token
): void {
  try {
    const existing: LocalTxRecord[] = JSON.parse(localStorage.getItem(LOCAL_TX_KEY) || '[]');
    existing.push({
      txHash,
      safeAddress,
      to,
      amount: amount.toString(),
      token,
      timestamp: new Date().toISOString(),
    });
    // Keep last 100 records
    if (existing.length > 100) existing.splice(0, existing.length - 100);
    localStorage.setItem(LOCAL_TX_KEY, JSON.stringify(existing));
  } catch (e) {
    console.warn('Failed to cache local transaction:', e);
  }
}

function getLocalTransactions(safeAddress: `0x${string}`): SafeTransaction[] {
  try {
    const records: LocalTxRecord[] = JSON.parse(localStorage.getItem(LOCAL_TX_KEY) || '[]');
    return records
      .filter(r => r.safeAddress.toLowerCase() === safeAddress.toLowerCase())
      .map(r => ({
        txHash: r.txHash,
        type: 'send' as const,
        to: r.to as `0x${string}`,
        from: safeAddress,
        amount: BigInt(r.amount),
        token: r.token,
        timestamp: r.timestamp,
        status: 'confirmed' as const,
        safe: safeAddress,
        executionDate: r.timestamp,
      }));
  } catch {
    return [];
  }
}

// ── Pending transaction tracking ──

export interface PendingTransaction {
  id: string;
  to: string;
  value: string;
  data: string;
  token: Token;
  nonce: string;
  createdAt: string;
  threshold: number;
  signatureCount: number;
  shareUrl: string;
}

function pendingTxKey(safeAddress: string): string {
  return `pending_txs_${safeAddress.toLowerCase()}`;
}

export function savePendingTransaction(safeAddress: string, pendingTx: PendingTransaction): void {
  try {
    const existing = getPendingTransactions(safeAddress);
    const filtered = existing.filter(tx => tx.id !== pendingTx.id);
    filtered.push(pendingTx);
    localStorage.setItem(pendingTxKey(safeAddress), JSON.stringify(filtered));
  } catch (e) {
    console.warn('Failed to save pending transaction:', e);
  }
}

export function getPendingTransactions(safeAddress: string): PendingTransaction[] {
  try {
    return JSON.parse(localStorage.getItem(pendingTxKey(safeAddress)) || '[]');
  } catch {
    return [];
  }
}

export function removePendingTransaction(safeAddress: string, id: string): void {
  try {
    const existing = getPendingTransactions(safeAddress);
    const filtered = existing.filter(tx => tx.id !== id);
    localStorage.setItem(pendingTxKey(safeAddress), JSON.stringify(filtered));
  } catch (e) {
    console.warn('Failed to remove pending transaction:', e);
  }
}

export function cleanupExecutedPendingTxs(safeAddress: string, confirmedNonces: Set<string>): void {
  try {
    const pending = getPendingTransactions(safeAddress);
    const remaining = pending.filter(tx => !confirmedNonces.has(tx.nonce));
    if (remaining.length !== pending.length) {
      localStorage.setItem(pendingTxKey(safeAddress), JSON.stringify(remaining));
    }
  } catch (e) {
    console.warn('Failed to cleanup pending transactions:', e);
  }
}

// Format relative time (e.g., "2h ago", "3d ago")
export function formatRelativeTime(timestamp: string): string {
  const now = Date.now();
  const txTime = new Date(timestamp).getTime();
  const diffMs = now - txTime;
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  if (diffSec < 60) return 'Just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHour < 24) return `${diffHour}h ago`;
  if (diffDay < 7) return `${diffDay}d ago`;
  
  // For older transactions, show the actual date
  return new Date(timestamp).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: new Date(timestamp).getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined,
  });
}

// Get transaction type icon
export function getTransactionIcon(type: SafeTransaction['type']): string {
  switch (type) {
    case 'send':
      return '↑';
    case 'receive':
      return '↓';
    case 'ownerChange':
      return '👥';
    default:
      return '•';
  }
}

// Get transaction type label
export function getTransactionTypeLabel(type: SafeTransaction['type']): string {
  switch (type) {
    case 'send':
      return 'Sent';
    case 'receive':
      return 'Received';
    case 'ownerChange':
      return 'Owner Change';
    default:
      return 'Transaction';
  }
}