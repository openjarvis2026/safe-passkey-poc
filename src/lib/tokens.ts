import { formatUnits, parseAbiItem, type Hex } from 'viem';
import { publicClient } from './relayer';

// Token interface
export interface Token {
  address: `0x${string}`;
  symbol: string;
  name: string;
  decimals: number;
  logoUrl?: string;
}

// Base Sepolia token addresses (testnet)
export const NATIVE_TOKEN: Token = {
  address: '0x0000000000000000000000000000000000000000' as `0x${string}`,
  symbol: 'ETH',
  name: 'Ethereum',
  decimals: 18,
};

export const TOKENS: Token[] = [
  NATIVE_TOKEN,
  {
    address: '0x036CbD53842c5426634e7929541eC2318f3dCF7e' as `0x${string}`,
    symbol: 'USDC',
    name: 'USD Coin',
    decimals: 6,
  },
  {
    address: '0x7439E9Bb6D8a84dd3A23fe621A30F95403F87fB9' as `0x${string}`,
    symbol: 'USDT',
    name: 'Tether USD',
    decimals: 6,
  },
  {
    address: '0x4200000000000000000000000000000000000006' as `0x${string}`,
    symbol: 'WETH',
    name: 'Wrapped Ethereum',
    decimals: 18,
  },
];

// ERC-20 ABI for balance queries
const ERC20_ABI = [
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
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

// Token balance with USD value
export interface TokenBalance {
  token: Token;
  balance: bigint;
  formattedBalance: string;
  usdValue: number | null;
}

// Fetch token balances using multicall
export async function getTokenBalances(walletAddress: `0x${string}`): Promise<TokenBalance[]> {
  try {
    // Prepare multicall for ERC-20 tokens
    const erc20Tokens = TOKENS.filter(token => token.address !== '0x0000000000000000000000000000000000000000');
    
    const multicallContracts = erc20Tokens.map(token => ({
      address: token.address,
      abi: ERC20_ABI,
      functionName: 'balanceOf' as const,
      args: [walletAddress],
    }));

    // Execute multicall for ERC-20 balances and get ETH balance
    const [ethBalance, erc20Results] = await Promise.all([
      publicClient.getBalance({ address: walletAddress }),
      multicallContracts.length > 0 ? publicClient.multicall({ contracts: multicallContracts }) : [],
    ]);

    // Get USD prices
    const usdPrices = await getTokenPricesUSD();

    // Combine results
    const balances: TokenBalance[] = [];

    // Add ETH balance
    const ethToken = TOKENS.find(t => t.symbol === 'ETH')!;
    balances.push({
      token: ethToken,
      balance: ethBalance,
      formattedBalance: formatUnits(ethBalance, ethToken.decimals),
      usdValue: usdPrices['ethereum'] ? parseFloat(formatUnits(ethBalance, ethToken.decimals)) * usdPrices['ethereum'] : null,
    });

    // Add ERC-20 balances
    erc20Results.forEach((result, index) => {
      const token = erc20Tokens[index];
      const balance = result.status === 'success' ? result.result as bigint : 0n;
      
      balances.push({
        token,
        balance,
        formattedBalance: formatUnits(balance, token.decimals),
        usdValue: usdPrices[getCoingeckoId(token.symbol)] ? 
          parseFloat(formatUnits(balance, token.decimals)) * usdPrices[getCoingeckoId(token.symbol)] : 
          null,
      });
    });

    return balances;
  } catch (error) {
    console.error('Error fetching token balances:', error);
    // Return empty balances on error
    return TOKENS.map(token => ({
      token,
      balance: 0n,
      formattedBalance: '0.0',
      usdValue: null,
    }));
  }
}

// Get USD prices from CoinGecko (free tier)
async function getTokenPricesUSD(): Promise<Record<string, number>> {
  try {
    const tokenIds = ['ethereum', 'usd-coin', 'tether', 'weth'];
    const response = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${tokenIds.join(',')}&vs_currencies=usd`,
      { 
        headers: { 'Accept': 'application/json' }
      }
    );

    if (!response.ok) {
      console.warn('Failed to fetch prices from CoinGecko');
      return {};
    }

    const prices = await response.json();
    
    // Transform to our format
    const result: Record<string, number> = {};
    for (const [tokenId, data] of Object.entries(prices)) {
      if (data && typeof data === 'object' && 'usd' in data) {
        result[tokenId] = data.usd as number;
      }
    }
    
    return result;
  } catch (error) {
    console.warn('Error fetching token prices:', error);
    return {};
  }
}

// Map token symbols to CoinGecko IDs
function getCoingeckoId(symbol: string): string {
  const mapping: Record<string, string> = {
    'ETH': 'ethereum',
    'USDC': 'usd-coin', 
    'USDT': 'tether',
    'WETH': 'weth',
  };
  return mapping[symbol] || symbol.toLowerCase();
}

// Find token by address
export function findTokenByAddress(address: `0x${string}`): Token | undefined {
  return TOKENS.find(token => token.address.toLowerCase() === address.toLowerCase());
}

// Format token amount for display
export function formatTokenAmount(amount: bigint, token: Token, maxDecimals = 6): string {
  const formatted = formatUnits(amount, token.decimals);
  const num = parseFloat(formatted);
  
  if (num === 0) return '0';
  if (num < 0.000001) return '< 0.000001';
  
  // For small amounts, show more decimals
  if (num < 1) {
    return num.toPrecision(4);
  }
  
  // For larger amounts, limit decimal places
  return num.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: Math.min(maxDecimals, token.decimals),
  });
}

// Format USD value
export function formatUSDValue(value: number | null): string {
  if (value === null) return '';
  if (value < 0.01) return '< $0.01';
  return value.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}