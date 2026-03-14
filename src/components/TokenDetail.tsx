import { useState, useEffect } from 'react';
import { formatUnits, formatEther } from 'viem';
import { type Token, type TokenBalance, getCoingeckoId, formatTokenAmount, formatUSDValue } from '../lib/tokens';
import TokenIcon from './TokenIcon';

interface Props {
  token: Token;
  balance: TokenBalance;
  safeAddress: string;
  onBack: () => void;
  onSwap: () => void;
}

const CHAINS = [
  { name: 'Base Sepolia', chainId: 84532, rpc: 'https://sepolia.base.org', icon: '🔵', nativeSymbol: 'ETH' },
  { name: 'Arbitrum Sepolia', chainId: 421614, rpc: 'https://sepolia-rollup.arbitrum.io/rpc', icon: '🔷', nativeSymbol: 'ETH' },
  { name: 'Optimism Sepolia', chainId: 11155420, rpc: 'https://sepolia.optimism.io', icon: '🔴', nativeSymbol: 'ETH' },
  { name: 'Sepolia', chainId: 11155111, rpc: 'https://rpc.sepolia.org', icon: '⟠', nativeSymbol: 'ETH' },
];

function formatLargeNumber(n: number): string {
  if (n >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(2)}K`;
  return `$${n.toFixed(2)}`;
}

interface MarketData {
  price: number;
  volume24h: number;
  marketCap: number;
}

interface ChainBalance {
  chain: typeof CHAINS[0];
  balance: bigint;
  loading: boolean;
  error: boolean;
}

async function fetchEthBalance(rpc: string, address: string): Promise<bigint> {
  const res = await fetch(rpc, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_getBalance', params: [address, 'latest'] }),
  });
  const data = await res.json();
  return BigInt(data.result || '0');
}

export default function TokenDetail({ token, balance, safeAddress, onBack, onSwap }: Props) {
  const [market, setMarket] = useState<MarketData | null>(null);
  const [chainBalances, setChainBalances] = useState<ChainBalance[]>([]);
  const [bridgeToast, setBridgeToast] = useState(false);
  const isNative = token.address === '0x0000000000000000000000000000000000000000';

  // Fetch market data
  useEffect(() => {
    const id = getCoingeckoId(token.symbol);
    fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${id}&vs_currencies=usd&include_24hr_vol=true&include_market_cap=true`)
      .then(r => r.json())
      .then(d => {
        if (d[id]) {
          setMarket({
            price: d[id].usd || 0,
            volume24h: d[id].usd_24h_vol || 0,
            marketCap: d[id].usd_market_cap || 0,
          });
        }
      })
      .catch(() => {});
  }, [token.symbol]);

  // Fetch multi-chain balances (ETH only)
  useEffect(() => {
    if (!isNative) {
      // For ERC-20, just show current chain
      setChainBalances([{
        chain: CHAINS[0], // Base Sepolia is current chain
        balance: balance.balance,
        loading: false,
        error: false,
      }]);
      return;
    }

    // For ETH, query all chains
    setChainBalances(CHAINS.map(c => ({ chain: c, balance: 0n, loading: true, error: false })));
    
    CHAINS.forEach((chain, i) => {
      fetchEthBalance(chain.rpc, safeAddress)
        .then(bal => {
          setChainBalances(prev => prev.map((cb, j) => j === i ? { ...cb, balance: bal, loading: false } : cb));
        })
        .catch(() => {
          setChainBalances(prev => prev.map((cb, j) => j === i ? { ...cb, loading: false, error: true } : cb));
        });
    });
  }, [token, safeAddress, isNative, balance.balance]);

  const totalBalance = isNative
    ? chainBalances.reduce((sum, cb) => sum + cb.balance, 0n)
    : balance.balance;
  
  const totalFormatted = formatUnits(totalBalance, token.decimals);
  const totalUSD = market ? parseFloat(totalFormatted) * market.price : (balance.usdValue || 0);

  return (
    <div className="fade-in stack-lg">
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button className="btn btn-icon" style={{ width: 44, height: 44, fontSize: 20 }} onClick={onBack}>←</button>
        <h2 style={{ fontSize: 20, fontWeight: 700 }}>{token.name}</h2>
      </div>

      {/* Token Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '8px 0' }}>
        <TokenIcon symbol={token.symbol} size={52} />
        <div>
          <div style={{ fontSize: 20, fontWeight: 700 }}>{token.name}</div>
          <div style={{ fontSize: 14, color: 'var(--text-secondary)' }}>{token.symbol}</div>
        </div>
        <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
          <div style={{ fontSize: 20, fontWeight: 700 }}>
            {market ? formatUSDValue(market.price) : '—'}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Current Price</div>
        </div>
      </div>

      {/* Market Data Pills */}
      {market && (
        <div style={{ display: 'flex', gap: 8 }}>
          <div style={{
            flex: 1, background: 'rgba(255,255,255,0.08)', borderRadius: 12,
            padding: '10px 14px', textAlign: 'center',
          }}>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.5px' }}>24h Volume</div>
            <div style={{ fontSize: 14, fontWeight: 600 }}>{formatLargeNumber(market.volume24h)}</div>
          </div>
          <div style={{
            flex: 1, background: 'rgba(255,255,255,0.08)', borderRadius: 12,
            padding: '10px 14px', textAlign: 'center',
          }}>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Market Cap</div>
            <div style={{ fontSize: 14, fontWeight: 600 }}>{formatLargeNumber(market.marketCap)}</div>
          </div>
        </div>
      )}

      {/* Total Balance Card */}
      <div style={{
        background: 'var(--bg-secondary)',
        border: '1px solid var(--border)',
        borderRadius: 20,
        padding: '24px 20px',
      }}>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '1px' }}>
          Total Balance
        </div>
        <div style={{ fontSize: 32, fontWeight: 800, letterSpacing: '-1px', marginBottom: 4 }}>
          {totalUSD > 0 ? formatUSDValue(totalUSD) : '$0.00'}
        </div>
        <div style={{ fontSize: 14, color: 'var(--text-secondary)' }}>
          {formatTokenAmount(totalBalance, token)} {token.symbol}
        </div>
      </div>

      {/* Chain Breakdown */}
      <div>
        <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>
          {isNative ? 'Balance by Chain' : 'Available On'}
        </h3>
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          {isNative ? (
            chainBalances.map((cb, i) => {
              const formatted = formatUnits(cb.balance, token.decimals);
              const usd = market ? parseFloat(formatted) * market.price : 0;
              return (
                <div key={cb.chain.chainId} style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  padding: '14px 16px',
                  borderBottom: i < chainBalances.length - 1 ? '1px solid var(--border)' : 'none',
                }}>
                  <span style={{ fontSize: 20, width: 32, textAlign: 'center' }}>{cb.chain.icon}</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 14, fontWeight: 500 }}>{cb.chain.name}</div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    {cb.loading ? (
                      <div className="spinner spinner-dark" style={{ width: 16, height: 16 }} />
                    ) : cb.error ? (
                      <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Error</span>
                    ) : (
                      <>
                        <div style={{ fontSize: 14, fontWeight: 500 }}>
                          {parseFloat(formatted).toFixed(4)} {token.symbol}
                        </div>
                        {usd > 0 && (
                          <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                            {formatUSDValue(usd)}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </div>
              );
            })
          ) : (
            <>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 12,
                padding: '14px 16px', borderBottom: '1px solid var(--border)',
              }}>
                <span style={{ fontSize: 20, width: 32, textAlign: 'center' }}>🔵</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 500 }}>Base Sepolia</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 14, fontWeight: 500 }}>
                    {formatTokenAmount(balance.balance, token)} {token.symbol}
                  </div>
                  {balance.usdValue !== null && balance.usdValue > 0 && (
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                      {formatUSDValue(balance.usdValue)}
                    </div>
                  )}
                </div>
              </div>
              <div style={{ padding: '12px 16px', textAlign: 'center' }}>
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  🔗 Multi-chain balance coming soon
                </span>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Action Buttons */}
      <div style={{ display: 'flex', gap: 12 }}>
        <button className="btn btn-primary" style={{ flex: 1 }} onClick={onSwap}>
          Swap
        </button>
        <button
          className="btn btn-secondary"
          style={{ flex: 1 }}
          onClick={() => {
            setBridgeToast(true);
            setTimeout(() => setBridgeToast(false), 2000);
          }}
        >
          Bridge
        </button>
      </div>

      {bridgeToast && (
        <div style={{
          position: 'fixed', bottom: 100, left: '50%', transform: 'translateX(-50%)',
          background: 'var(--bg-secondary)', border: '1px solid var(--border)',
          borderRadius: 12, padding: '10px 20px', fontSize: 14,
          boxShadow: '0 4px 16px rgba(0,0,0,0.3)', zIndex: 200,
        }}>
          🌉 Bridge coming soon
        </div>
      )}

      {/* Bottom spacer */}
      <div style={{ height: 20 }} />
    </div>
  );
}
