import { useState, useEffect } from 'react';
import { getTokenBalances, formatTokenAmount, formatUSDValue, type TokenBalance } from '../lib/tokens';

interface Props {
  safeAddress: `0x${string}`;
}

export default function TokenList({ safeAddress }: Props) {
  const [balances, setBalances] = useState<TokenBalance[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<number>(0);

  // Fetch token balances
  useEffect(() => {
    const fetchBalances = async () => {
      try {
        setLoading(true);
        const tokenBalances = await getTokenBalances(safeAddress);
        setBalances(tokenBalances);
        setLastUpdated(Date.now());
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
        {balances.map(balance => {
          const { token, formattedBalance, usdValue } = balance;
          const hasBalance = parseFloat(formattedBalance) > 0;
          
          return (
            <div 
              key={token.address} 
              className={`token-item ${!hasBalance ? 'token-item-zero' : ''}`}
            >
              <div className="token-icon">
                {token.symbol === 'ETH' && '⚡'}
                {token.symbol === 'USDC' && '💙'}
                {token.symbol === 'USDT' && '💚'}
                {token.symbol === 'WETH' && '🔷'}
              </div>
              
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

      {lastUpdated > 0 && (
        <div style={{ 
          textAlign: 'center', 
          marginTop: 12, 
          fontSize: 11, 
          color: 'var(--text-muted)' 
        }}>
          Last updated: {new Date(lastUpdated).toLocaleTimeString()}
        </div>
      )}
    </div>
  );
}