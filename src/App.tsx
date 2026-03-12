import { useState, useEffect } from 'react';
import { parseRoute, type Route } from './lib/router';
import { loadSafe, type SavedSafe } from './lib/storage';
import { relayerAccount, EXPLORER } from './lib/relayer';
import DeployFlow from './components/DeployFlow';
import Dashboard from './components/Dashboard';
import JoinPage from './components/JoinPage';
import SignPage from './components/SignPage';

function AddrLink({ addr }: { addr: string }) {
  return <a href={`${EXPLORER}/address/${addr}`} target="_blank" rel="noreferrer">{addr.slice(0, 10)}…{addr.slice(-4)}</a>;
}

export default function App() {
  const [route, setRoute] = useState<Route>(parseRoute());
  const [savedSafe, setSavedSafe] = useState<SavedSafe | null>(loadSafe());

  useEffect(() => {
    const handleHashChange = () => {
      setRoute(parseRoute());
      // Re-check localStorage in case we came back from join
      setSavedSafe(loadSafe());
    };
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  const handleSafeCreated = (safe: SavedSafe) => {
    setSavedSafe(safe);
  };

  const handleDisconnect = () => {
    setSavedSafe(null);
    window.location.hash = '#/';
  };

  const handleJoined = (safe: SavedSafe) => {
    setSavedSafe(safe);
  };

  return (
    <div style={{ maxWidth: 700, margin: '40px auto', fontFamily: 'system-ui', padding: '0 20px' }}>
      <h1>🔐 Safe + Passkeys PoC</h1>
      <p style={{ color: '#666' }}>Base Sepolia · Relayer: <AddrLink addr={relayerAccount.address} /></p>

      {route.page === 'join' && (
        <JoinPage safeAddress={route.safeAddress} onJoined={handleJoined} />
      )}

      {route.page === 'sign' && (
        <SignPage encodedData={route.data} />
      )}

      {route.page === 'home' && savedSafe && (
        <Dashboard safe={savedSafe} onDisconnect={handleDisconnect} />
      )}

      {route.page === 'home' && !savedSafe && (
        <DeployFlow onSafeCreated={handleSafeCreated} />
      )}
    </div>
  );
}
