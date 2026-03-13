interface Props {
  symbol: string;
  size?: number;
}

const ICON_CONFIG: Record<string, { bg: string; color: string; letter: string }> = {
  ETH: { bg: '#627EEA', color: '#fff', letter: 'E' },
  USDC: { bg: '#2775CA', color: '#fff', letter: '$' },
  USDT: { bg: '#26A17B', color: '#fff', letter: '₮' },
  WETH: { bg: '#627EEA', color: '#fff', letter: 'W' },
};

export default function TokenIcon({ symbol, size = 32 }: Props) {
  const config = ICON_CONFIG[symbol] || { bg: '#888', color: '#fff', letter: symbol[0] || '?' };
  const fontSize = size * 0.45;

  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        background: config.bg,
        color: config.color,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize,
        fontWeight: 700,
        flexShrink: 0,
        lineHeight: 1,
      }}
    >
      {config.letter}
    </div>
  );
}
