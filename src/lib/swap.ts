import { encodeFunctionData, parseUnits, formatUnits, type Hex } from 'viem';
import { publicClient } from './relayer';
import { relayerAccount } from './relayer';
import { type Token, NATIVE_TOKEN, TOKENS } from './tokens';

// Uniswap V3 Contract Addresses
// Note: Base Sepolia doesn't have official Uniswap V3 deployment
// Using mainnet Base addresses for reference (would need deployment on testnet)
const UNISWAP_V3_ADDRESSES = {
  // These are mainnet Base addresses - for production use
  QUOTER: '0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a' as `0x${string}`,
  SWAP_ROUTER02: '0x2626664c2603336E57B271c5C0b26F421741e481' as `0x${string}`,
  // For Base Sepolia testnet, these would need to be deployed or use alternative DEX
} as const;

// MultiSend contract address (Base Sepolia)
const MULTISEND_ADDRESS = '0x38869bf66a61cF6bDB996A6aE40D5853Fd43B526' as `0x${string}`;

// Fee configuration
const PROTOCOL_FEE_BPS = 50; // 0.5% = 50 basis points
const TREASURY_ADDRESS = relayerAccount.address; // Using relayer as treasury for now

// Quoter ABI (for getting swap quotes)
const QUOTER_ABI = [
  {
    name: 'quoteExactInputSingle',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'tokenIn', type: 'address' },
      { name: 'tokenOut', type: 'address' },
      { name: 'fee', type: 'uint24' },
      { name: 'amountIn', type: 'uint256' },
      { name: 'sqrtPriceLimitX96', type: 'uint160' }
    ],
    outputs: [
      { name: 'amountOut', type: 'uint256' },
      { name: 'sqrtPriceX96After', type: 'uint160' },
      { name: 'initializedTicksCrossed', type: 'uint32' },
      { name: 'gasEstimate', type: 'uint256' }
    ]
  }
] as const;

// SwapRouter02 ABI (for executing swaps)
const SWAP_ROUTER_ABI = [
  {
    name: 'exactInputSingle',
    type: 'function',
    stateMutability: 'payable',
    inputs: [{
      name: 'params',
      type: 'tuple',
      components: [
        { name: 'tokenIn', type: 'address' },
        { name: 'tokenOut', type: 'address' },
        { name: 'fee', type: 'uint24' },
        { name: 'recipient', type: 'address' },
        { name: 'deadline', type: 'uint256' },
        { name: 'amountIn', type: 'uint256' },
        { name: 'amountOutMinimum', type: 'uint256' },
        { name: 'sqrtPriceLimitX96', type: 'uint160' }
      ]
    }],
    outputs: [{ name: 'amountOut', type: 'uint256' }]
  }
] as const;

// ERC20 ABI for approve and transfer
const ERC20_ABI = [
  {
    name: 'approve',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' }
    ],
    outputs: [{ name: '', type: 'bool' }]
  },
  {
    name: 'transfer',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' }
    ],
    outputs: [{ name: '', type: 'bool' }]
  }
] as const;

// MultiSend ABI
const MULTISEND_ABI = [
  {
    name: 'multiSend',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'transactions', type: 'bytes' }],
    outputs: []
  }
] as const;

export interface SwapQuote {
  tokenIn: Token;
  tokenOut: Token;
  amountIn: bigint;
  amountOut: bigint;
  amountAfterFee: bigint;
  feeAmount: bigint;
  priceImpact: number;
  gasEstimate: bigint;
}

export interface SwapParams {
  tokenIn: Token;
  tokenOut: Token;
  amountIn: string; // User input as string
  slippagePercent: number; // e.g., 0.5 for 0.5%
  recipient: `0x${string}`;
}

/**
 * Get a swap quote from Uniswap V3 Quoter
 */
export async function getSwapQuote(
  tokenIn: Token,
  tokenOut: Token,
  amountIn: string
): Promise<SwapQuote | null> {
  try {
    // Convert input amount to bigint
    const amountInWei = parseUnits(amountIn, tokenIn.decimals);
    
    if (amountInWei === 0n) {
      throw new Error('Amount must be greater than 0');
    }

    // Calculate fee amount (0.5% of input)
    const feeAmount = (amountInWei * BigInt(PROTOCOL_FEE_BPS)) / 10000n;
    const amountAfterFee = amountInWei - feeAmount;

    // For demo purposes, return a mock quote since Base Sepolia doesn't have Uniswap V3
    // In production, this would call the actual Quoter contract
    const mockAmountOut = calculateMockAmountOut(tokenIn, tokenOut, amountAfterFee);

    return {
      tokenIn,
      tokenOut,
      amountIn: amountInWei,
      amountOut: mockAmountOut,
      amountAfterFee,
      feeAmount,
      priceImpact: 0.1, // Mock 0.1% price impact
      gasEstimate: 150000n // Mock gas estimate
    };

    // Uncomment this when using actual Uniswap V3 contracts:
    /*
    const result = await publicClient.readContract({
      address: UNISWAP_V3_ADDRESSES.QUOTER,
      abi: QUOTER_ABI,
      functionName: 'quoteExactInputSingle',
      args: [
        tokenIn.address === NATIVE_TOKEN.address ? TOKENS.find(t => t.symbol === 'WETH')!.address : tokenIn.address,
        tokenOut.address === NATIVE_TOKEN.address ? TOKENS.find(t => t.symbol === 'WETH')!.address : tokenOut.address,
        3000, // 0.3% fee tier (most common)
        amountAfterFee,
        0n // No price limit
      ]
    });

    return {
      tokenIn,
      tokenOut,
      amountIn: amountInWei,
      amountOut: result[0],
      amountAfterFee,
      feeAmount,
      priceImpact: calculatePriceImpact(amountInWei, result[0], tokenIn, tokenOut),
      gasEstimate: result[3]
    };
    */

  } catch (error) {
    console.error('Error getting swap quote:', error);
    return null;
  }
}

/**
 * Mock price calculation for demo purposes
 */
function calculateMockAmountOut(tokenIn: Token, tokenOut: Token, amountIn: bigint): bigint {
  // Mock exchange rates (in production, this comes from Uniswap pools)
  const rates: Record<string, Record<string, number>> = {
    'ETH': { 'USDC': 3000, 'USDT': 3000, 'WETH': 1 },
    'USDC': { 'ETH': 1/3000, 'USDT': 1, 'WETH': 1/3000 },
    'USDT': { 'ETH': 1/3000, 'USDC': 1, 'WETH': 1/3000 },
    'WETH': { 'ETH': 1, 'USDC': 3000, 'USDT': 3000 }
  };

  const rate = rates[tokenIn.symbol]?.[tokenOut.symbol] || 1;
  const amountInFormatted = parseFloat(formatUnits(amountIn, tokenIn.decimals));
  const amountOutFormatted = amountInFormatted * rate;
  
  return parseUnits(amountOutFormatted.toString(), tokenOut.decimals);
}

/**
 * Encode a swap transaction for Safe execution
 */
export function encodeSwapTransaction(
  safeAddress: `0x${string}`,
  quote: SwapQuote,
  slippagePercent: number,
  deadline?: number
): { to: `0x${string}`; value: bigint; data: `0x${string}` } {
  // Calculate minimum amount out with slippage
  const slippageBps = BigInt(Math.floor(slippagePercent * 100)); // Convert to basis points
  const minAmountOut = (quote.amountOut * (10000n - slippageBps)) / 10000n;
  
  const swapDeadline = BigInt(deadline || Math.floor(Date.now() / 1000) + 1200); // 20 minutes

  // Prepare transactions for MultiSend
  const transactions: Array<{ to: `0x${string}`; value: bigint; data: `0x${string}` }> = [];

  // TODO: Uniswap V3 is NOT deployed on Base Sepolia. The swap call is skipped for now.
  // On production (Base mainnet), uncomment the swap logic below and use real Uniswap addresses.
  // For demo purposes, we only execute the fee transfer so the transaction succeeds on-chain.
  console.warn('[Swap] Uniswap V3 is not available on Base Sepolia. Only the fee transfer will execute. Real swaps require production Uniswap addresses on Base mainnet.');

  // Fee transfer
  if (quote.tokenIn.address !== NATIVE_TOKEN.address) {
    // ERC20 fee transfer
    const feeTransferData = encodeFunctionData({
      abi: ERC20_ABI,
      functionName: 'transfer',
      args: [TREASURY_ADDRESS, quote.feeAmount]
    });
    
    transactions.push({
      to: quote.tokenIn.address,
      value: 0n,
      data: feeTransferData
    });
  } else {
    // ETH fee transfer
    transactions.push({
      to: TREASURY_ADDRESS,
      value: quote.feeAmount,
      data: '0x' as `0x${string}`
    });
  }

  // TODO: Re-enable when Uniswap V3 is available on the target chain
  // // Token approval (if ERC20)
  // if (quote.tokenIn.address !== NATIVE_TOKEN.address) {
  //   const approvalData = encodeFunctionData({
  //     abi: ERC20_ABI,
  //     functionName: 'approve',
  //     args: [UNISWAP_V3_ADDRESSES.SWAP_ROUTER02, quote.amountAfterFee]
  //   });
  //   transactions.push({ to: quote.tokenIn.address, value: 0n, data: approvalData });
  // }
  //
  // // Swap transaction
  // const swapParams = {
  //   tokenIn: quote.tokenIn.address === NATIVE_TOKEN.address ?
  //     TOKENS.find(t => t.symbol === 'WETH')!.address : quote.tokenIn.address,
  //   tokenOut: quote.tokenOut.address === NATIVE_TOKEN.address ?
  //     TOKENS.find(t => t.symbol === 'WETH')!.address : quote.tokenOut.address,
  //   fee: 3000,
  //   recipient: safeAddress,
  //   deadline: swapDeadline,
  //   amountIn: quote.amountAfterFee,
  //   amountOutMinimum: minAmountOut,
  //   sqrtPriceLimitX96: 0n
  // };
  // const swapData = encodeFunctionData({
  //   abi: SWAP_ROUTER_ABI,
  //   functionName: 'exactInputSingle',
  //   args: [swapParams]
  // });
  // transactions.push({
  //   to: UNISWAP_V3_ADDRESSES.SWAP_ROUTER02,
  //   value: quote.tokenIn.address === NATIVE_TOKEN.address ? quote.amountAfterFee : 0n,
  //   data: swapData
  // });

  // Encode MultiSend transaction
  const multiSendData = encodeMultiSendData(transactions);
  
  const multiSendTxData = encodeFunctionData({
    abi: MULTISEND_ABI,
    functionName: 'multiSend',
    args: [multiSendData]
  });

  return {
    to: MULTISEND_ADDRESS,
    value: quote.tokenIn.address === NATIVE_TOKEN.address ? quote.feeAmount : 0n, // Only fee for now (no swap on testnet)
    data: multiSendTxData
  };
}

/**
 * Encode multiple transactions for MultiSend
 */
function encodeMultiSendData(transactions: Array<{ to: `0x${string}`; value: bigint; data: `0x${string}` }>): `0x${string}` {
  let encodedData = '0x';
  
  for (const tx of transactions) {
    // Operation: 0 = CALL, 1 = DELEGATECALL
    const operation = '00'; // CALL
    
    // Address (20 bytes)
    const to = tx.to.slice(2);
    
    // Value (32 bytes)
    const value = tx.value.toString(16).padStart(64, '0');
    
    // Data length (32 bytes)
    const dataLength = ((tx.data.length - 2) / 2).toString(16).padStart(64, '0');
    
    // Data
    const data = tx.data.slice(2);
    
    encodedData += operation + to + value + dataLength + data;
  }
  
  return encodedData as `0x${string}`;
}

/**
 * Calculate price impact percentage
 */
function calculatePriceImpact(amountIn: bigint, amountOut: bigint, tokenIn: Token, tokenOut: Token): number {
  // This is a simplified calculation - in production, you'd compare against current pool price
  // For now, return a mock value
  return 0.1; // 0.1% price impact
}

/**
 * Get the best route for a token pair
 * In production, this would analyze multiple fee tiers and routes
 */
export function getBestRoute(tokenIn: Token, tokenOut: Token): { fee: number; route: Token[] } {
  // For demo, return direct route with 0.3% fee tier (most common)
  return {
    fee: 3000, // 0.3%
    route: [tokenIn, tokenOut]
  };
}

/**
 * Format swap quote for display
 */
export function formatSwapQuote(quote: SwapQuote): {
  amountIn: string;
  amountOut: string;
  rate: string;
  feeAmount: string;
  priceImpact: string;
} {
  const amountInFormatted = formatUnits(quote.amountIn, quote.tokenIn.decimals);
  const amountOutFormatted = formatUnits(quote.amountOut, quote.tokenOut.decimals);
  const feeFormatted = formatUnits(quote.feeAmount, quote.tokenIn.decimals);
  
  // Calculate exchange rate
  const rate = parseFloat(amountOutFormatted) / parseFloat(amountInFormatted);
  
  return {
    amountIn: amountInFormatted,
    amountOut: amountOutFormatted,
    rate: `1 ${quote.tokenIn.symbol} = ${rate.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 6 })} ${quote.tokenOut.symbol}`,
    feeAmount: feeFormatted,
    priceImpact: `${quote.priceImpact.toFixed(2)}%`
  };
}