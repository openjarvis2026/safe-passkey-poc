import { useState, useEffect } from 'react';
import { formatEther, parseEther, toHex } from 'viem';
import { createPasskey, signWithPasskey, type PasskeyCredential } from './lib/webauthn';
import { deploySignerProxy, getSignerAddress } from './lib/signer';
import { deploySafe, getNonce, execTransaction } from './lib/safe';
import { computeSafeTxHash, packSafeSignature } from './lib/encoding';
import { publicClient, relayerAccount, EXPLORER } from './lib/relayer';

type Status = 'idle' | 'loading' | 'done' | 'error';

function TxLink({ hash }: { hash: string }) {
  return <a href={`${EXPLORER}/tx/${hash}`} target="_blank" rel="noreferrer">🔗 {hash.slice(0, 10)}…</a>;
}

function AddrLink({ addr }: { addr: string }) {
  return <a href={`${EXPLORER}/address/${addr}`} target="_blank" rel="noreferrer">{addr.slice(0, 10)}…{addr.slice(-4)}</a>;
}

export default function App() {
  // State
  const [credential, setCredential] = useState<PasskeyCredential | null>(null);
  const [signerAddress, setSignerAddress] = useState<`0x${string}` | null>(null);
  const [safeAddress, setSafeAddress] = useState<`0x${string}` | null>(null);
  const [balance, setBalance] = useState<bigint>(0n);
  const [txHashes, setTxHashes] = useState<Record<string, string>>({});
  const [statuses, setStatuses] = useState<Record<string, Status>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [signatureData, setSignatureData] = useState<any>(null);

  const setStep = (step: string, status: Status, extra?: { tx?: string; error?: string }) => {
    setStatuses((s) => ({ ...s, [step]: status }));
    if (extra?.tx) setTxHashes((t) => ({ ...t, [step]: extra.tx! }));
    if (extra?.error) setErrors((e) => ({ ...e, [step]: extra.error! }));
  };

  // Poll balance
  useEffect(() => {
    if (!safeAddress) return;
    const poll = setInterval(async () => {
      const b = await publicClient.getBalance({ address: safeAddress });
      setBalance(b);
    }, 4000);
    publicClient.getBalance({ address: safeAddress }).then(setBalance);
    return () => clearInterval(poll);
  }, [safeAddress]);

  // Step 1: Create Passkey
  const handleCreatePasskey = async () => {
    setStep('passkey', 'loading');
    try {
      const cred = await createPasskey();
      setCredential(cred);
      setStep('passkey', 'done');
    } catch (e: any) {
      setStep('passkey', 'error', { error: e.message });
    }
  };

  // Step 2: Deploy Signer
  const handleDeploySigner = async () => {
    if (!credential) return;
    setStep('signer', 'loading');
    try {
      const tx = await deploySignerProxy(credential.publicKey.x, credential.publicKey.y);
      const addr = await getSignerAddress(credential.publicKey.x, credential.publicKey.y);
      setSignerAddress(addr);
      setStep('signer', 'done', { tx });
    } catch (e: any) {
      setStep('signer', 'error', { error: e.message });
    }
  };

  // Step 3: Deploy Safe
  const handleDeploySafe = async () => {
    if (!signerAddress) return;
    setStep('safe', 'loading');
    try {
      const { txHash, safeAddress: addr } = await deploySafe(signerAddress);
      setSafeAddress(addr);
      setStep('safe', 'done', { tx: txHash });
    } catch (e: any) {
      setStep('safe', 'error', { error: e.message });
    }
  };

  // Step 5: Sign with Passkey
  const handleSign = async () => {
    if (!credential || !safeAddress || !signerAddress) return;
    setStep('sign', 'loading');
    try {
      const nonce = await getNonce(safeAddress);
      // Send 0.0001 ETH to relayer as demo tx
      const to = relayerAccount.address;
      const value = parseEther('0.0001');
      const data = '0x' as `0x${string}`;

      const safeTxHash = computeSafeTxHash(safeAddress, to, value, data, nonce);
      // Convert hash to Uint8Array challenge
      const hashBytes = new Uint8Array(32);
      for (let i = 0; i < 32; i++) {
        hashBytes[i] = parseInt(safeTxHash.slice(2 + i * 2, 4 + i * 2), 16);
      }

      const sig = await signWithPasskey(credential.rawId, hashBytes);
      setSignatureData({ ...sig, to, value, data, nonce });
      setStep('sign', 'done');
    } catch (e: any) {
      setStep('sign', 'error', { error: e.message });
    }
  };

  // Step 6: Execute
  const handleExecute = async () => {
    if (!signatureData || !safeAddress || !signerAddress) return;
    setStep('exec', 'loading');
    try {
      const packed = packSafeSignature(
        signerAddress,
        signatureData.authenticatorData,
        signatureData.clientDataJSON,
        signatureData.challengeOffset,
        signatureData.r,
        signatureData.s
      );
      const tx = await execTransaction(
        safeAddress,
        signatureData.to,
        signatureData.value,
        signatureData.data,
        packed
      );
      setStep('exec', 'done', { tx });
    } catch (e: any) {
      setStep('exec', 'error', { error: e.message });
    }
  };

  const StatusBadge = ({ step }: { step: string }) => {
    const s = statuses[step];
    if (!s || s === 'idle') return <span>⬜</span>;
    if (s === 'loading') return <span>⏳</span>;
    if (s === 'done') return <span>✅</span>;
    return <span title={errors[step]}>❌</span>;
  };

  return (
    <div style={{ maxWidth: 700, margin: '40px auto', fontFamily: 'system-ui', padding: '0 20px' }}>
      <h1>🔐 Safe + Passkeys PoC</h1>
      <p style={{ color: '#666' }}>Base Sepolia · Relayer: <AddrLink addr={relayerAccount.address} /></p>

      {/* Step 1 */}
      <div style={stepStyle}>
        <h3><StatusBadge step="passkey" /> Step 1: Create Passkey</h3>
        <button onClick={handleCreatePasskey} disabled={statuses.passkey === 'loading' || statuses.passkey === 'done'}>
          {statuses.passkey === 'loading' ? 'Creating…' : 'Create Passkey'}
        </button>
        {credential && (
          <div style={infoStyle}>
            <div>x: {credential.publicKey.x.toString(16).slice(0, 16)}…</div>
            <div>y: {credential.publicKey.y.toString(16).slice(0, 16)}…</div>
          </div>
        )}
        {errors.passkey && <div style={errorStyle}>{errors.passkey}</div>}
      </div>

      {/* Step 2 */}
      <div style={stepStyle}>
        <h3><StatusBadge step="signer" /> Step 2: Deploy Signer Proxy</h3>
        <button onClick={handleDeploySigner} disabled={!credential || statuses.signer === 'loading' || statuses.signer === 'done'}>
          Deploy Signer
        </button>
        {txHashes.signer && <div style={infoStyle}><TxLink hash={txHashes.signer} /></div>}
        {signerAddress && <div style={infoStyle}>Signer: <AddrLink addr={signerAddress} /></div>}
        {errors.signer && <div style={errorStyle}>{errors.signer}</div>}
      </div>

      {/* Step 3 */}
      <div style={stepStyle}>
        <h3><StatusBadge step="safe" /> Step 3: Deploy Safe</h3>
        <button onClick={handleDeploySafe} disabled={!signerAddress || statuses.safe === 'loading' || statuses.safe === 'done'}>
          Deploy Safe
        </button>
        {txHashes.safe && <div style={infoStyle}><TxLink hash={txHashes.safe} /></div>}
        {safeAddress && <div style={infoStyle}>Safe: <AddrLink addr={safeAddress} /></div>}
        {errors.safe && <div style={errorStyle}>{errors.safe}</div>}
      </div>

      {/* Step 4 */}
      <div style={stepStyle}>
        <h3>{balance > 0n ? '✅' : '⬜'} Step 4: Fund Safe</h3>
        {safeAddress ? (
          <div style={infoStyle}>
            <div>Send Base Sepolia ETH to: <code>{safeAddress}</code></div>
            <div>Balance: <strong>{formatEther(balance)} ETH</strong></div>
          </div>
        ) : (
          <p style={{ color: '#999' }}>Deploy Safe first</p>
        )}
      </div>

      {/* Step 5 */}
      <div style={stepStyle}>
        <h3><StatusBadge step="sign" /> Step 5: Sign Transaction</h3>
        <p style={{ color: '#666', fontSize: 14 }}>Send 0.0001 ETH from Safe to relayer</p>
        <button onClick={handleSign} disabled={!safeAddress || balance === 0n || statuses.sign === 'loading' || statuses.sign === 'done'}>
          Sign with Passkey
        </button>
        {statuses.sign === 'done' && <div style={infoStyle}>Signature ready ✍️</div>}
        {errors.sign && <div style={errorStyle}>{errors.sign}</div>}
      </div>

      {/* Step 6 */}
      <div style={stepStyle}>
        <h3><StatusBadge step="exec" /> Step 6: Execute Transaction</h3>
        <button onClick={handleExecute} disabled={!signatureData || statuses.exec === 'loading' || statuses.exec === 'done'}>
          Execute on-chain
        </button>
        {txHashes.exec && <div style={infoStyle}><TxLink hash={txHashes.exec} /></div>}
        {errors.exec && <div style={errorStyle}>{errors.exec}</div>}
      </div>
    </div>
  );
}

const stepStyle: React.CSSProperties = {
  border: '1px solid #e0e0e0',
  borderRadius: 8,
  padding: 16,
  marginBottom: 12,
};

const infoStyle: React.CSSProperties = {
  marginTop: 8,
  padding: 8,
  background: '#f5f5f5',
  borderRadius: 4,
  fontSize: 13,
  wordBreak: 'break-all',
};

const errorStyle: React.CSSProperties = {
  marginTop: 8,
  color: 'red',
  fontSize: 13,
};
