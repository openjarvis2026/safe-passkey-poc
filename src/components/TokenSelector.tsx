import { useState, useEffect } from 'react';
import { getTokenBalances, formatTokenAmount, formatUSDValue, type Token, type TokenBalance } from '../lib/tokens';

interface Props {
  safeAddress: `0x${string}`;
  selectedToken: Token | null;
  onSelect: (token: Token) => void;
  onClose: () => void;
}

export default function TokenSelector({ safeAddress, selectedToken, onSelect, onClose }: Props) {
  const [balances, setBalances] = useState<TokenBalance[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchBalances = async () => {
      try {
        const tokenBalances = await getTokenBalances(safeAddress);
        setBalances(tokenBalances);
      } catch (error) {
        console.error('Error fetching token balances:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchBalances();
  }, [safeAddress]);

  const handleSelect = (token: Token) => {
    onSelect(token);
    onClose();
  };

  return (
    <div className="token-selector-overlay">
      <div className="token-selector-modal">
        <div className="token-selector-header">
          <h3 style={{ fontSize: 18, fontWeight: 600 }}>Select Token</h3>
          <button 
            className="btn btn-icon" 
            style={{ width: 32, height: 32, fontSize: 16 }}
            onClick={onClose}
          >
            ✕
          </button>
        </div>

        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
            <div className="spinner spinner-dark" style={{ width: 20, height: 20 }} />
          </div>
        ) : (
          <div className="token-selector-list">
            {balances.map(balance => {
              const { token, formattedBalance, usdValue } = balance;
              const hasBalance = parseFloat(formattedBalance) > 0;
              const isSelected = selectedToken?.address.toLowerCase() === token.address.toLowerCase();
              
              return (
                <button
                  key={token.address}
                  className={`token-selector-item ${isSelected ? 'selected' : ''} ${!hasBalance ? 'zero-balance' : ''}`}
                  onClick={() => handleSelect(token)}
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

                  {isSelected && (
                    <div className="token-selected-check">✓</div>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}