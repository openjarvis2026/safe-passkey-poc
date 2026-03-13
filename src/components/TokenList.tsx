import { useState, useEffect } from 'react';
import { formatUnits } from 'viem';
import { getTokenBalances, formatTokenAmount, formatUSDValue, type TokenBalance } from '../lib/tokens';
import TokenIcon from './TokenIcon';

interface Props {
  safeAddress: `0x${string}`;
  ethBalance?: bigint;
}

export default function TokenList({ safeAddress, ethBalance }: Props) {
  const [balances, setBalances] = useState<TokenBalance[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAll, setShowAll] = useState(false);

  // Fetch token balances
  useEffect(() => {
    const fetchBalances = async () => {
      try {
        setLoading(true);
        const tokenBalances = await getTokenBalances(safeAddress);
        setBalances(tokenBalances);
      } catch (error) {
        console.error('Error fetching token balances:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchBalances();
    
    // Refresh balances every 30 seconds
    const interval = setInterval(fetchBalances, 30000);
    return () => clearInterval(interval);
  }, [safeAddress]);

  // Override ETH balance from parent if provided
  useEffect(() => {
    if (ethBalance !== undefined && balances.length > 0) {
      setBalances(prev => prev.map(b => {
        if (b.token.symbol === 'ETH') {
          return {
            ...b,
            balance: ethBalance,
            formattedBalance: formatUnits(ethBalance, b.token.decimals),
            usdValue: b.usdValue !== null && b.balance > 0n
              ? (b.usdValue / parseFloat(b.formattedBalance)) * parseFloat(formatUnits(ethBalance, b.token.decimals))
              : b.usdValue,
          };
        }
        return b;
      }));
    }
  }, [ethBalance]);

  // Calculate total portfolio value
  const totalUSD = balances.reduce((sum, balance) => {
    return sum + (balance.usdValue || 0);
  }, 0);

  if (loading) {
    return (
      <div className="card">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div className="spinner spinner-dark" style={{ width: 20, height: 20 }} />
          <span style={{ marginLeft: 8, fontSize: 14 }}>Loading tokens...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h3 style={{ fontSize: 16, fontWeight: 600 }}>Tokens</h3>
        {totalUSD > 0 && (
          <span className="text-secondary text-sm">
            {formatUSDValue(totalUSD)}
          </span>
        )}
      </div>

      <div className="token-list">
        {balances
          .filter(b => b.token.symbol !== 'WETH') // Hide WETH
          .filter(b => {
            const hasBalance = parseFloat(b.formattedBalance) > 0;
            const isNative = b.token.symbol === 'ETH';
            return isNative || hasBalance || showAll;
          })
          .map(balance => {
          const { token, formattedBalance, usdValue } = balance;
          const hasBalance = parseFloat(formattedBalance) > 0;
          
          return (
            <div 
              key={token.address} 
              className={`token-item ${!hasBalance ? 'token-item-zero' : ''}`}
            >
              <TokenIcon symbol={token.symbol} size={36} />
              
              <div className="token-info">
                <div className="token-symbol">{token.symbol}</div>
                <div className="token-name">{token.name}</div>
              </div>
              
              <div className="token-balance">
                <div className="balance-amount">
                  {formatTokenAmount(balance.balance, token)}
                </div>
                {usdValue !== null && hasBalance && (
                  <div className="balance-usd">
                    {formatUSDValue(usdValue)}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {balances.some(b => b.token.symbol !== 'WETH' && b.token.symbol !== 'ETH' && parseFloat(b.formattedBalance) === 0) && !showAll && (
        <button 
          className="btn btn-ghost btn-sm" 
          style={{ width: '100%', marginTop: 8, fontSize: 13, color: 'var(--text-secondary)' }}
          onClick={() => setShowAll(true)}
        >
          Show all tokens ▾
        </button>
      )}
      {showAll && (
        <button 
          className="btn btn-ghost btn-sm" 
          style={{ width: '100%', marginTop: 8, fontSize: 13, color: 'var(--text-secondary)' }}
          onClick={() => setShowAll(false)}
        >
          Hide zero balances ▴
        </button>
      )}
    </div>
  );
}