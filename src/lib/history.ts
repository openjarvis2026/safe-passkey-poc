import { getAddress } from 'viem';
import { type Token, findTokenByAddress, NATIVE_TOKEN } from './tokens';

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
    
    // Fetch both outgoing transactions and incoming transfers
    const [outgoingTxs, incomingTransfers] = await Promise.allSettled([
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
      })
    ]);

    const transactions: SafeTransaction[] = [];

    // Process outgoing transactions
    if (outgoingTxs.status === 'fulfilled') {
      const response = outgoingTxs.value;
      if (response.ok) {
        const data: SafeApiResponse = await response.json();
        for (const tx of data.results) {
          const normalized = normalizeTransaction(tx, checksummedAddress);
          if (normalized) {
            transactions.push(normalized);
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
        for (const transfer of data.results) {
          const normalized = normalizeIncomingTransfer(transfer, checksummedAddress);
          if (normalized) {
            transactions.push(normalized);
          }
        }
      } else if (response.status !== 404 && response.status !== 422) {
        // Log non-404/422 errors but continue
        console.warn(`Error fetching incoming transfers (${response.status}):`, response.statusText);
      }
    } else {
      console.warn('Failed to fetch incoming transfers:', incomingTransfers.reason);
    }

    // If no transactions found, return empty array (graceful handling for new Safes)
    if (transactions.length === 0) {
      console.log('No transactions found for Safe:', checksummedAddress);
      return [];
    }

    // Sort by timestamp (newest first)
    return transactions.sort((a, b) => 
      new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );

  } catch (error) {
    console.error('Error fetching transaction history:', error);
    throw error;
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