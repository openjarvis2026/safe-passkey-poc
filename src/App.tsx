import { useState, useEffect } from 'react';
import { parseRoute, type Route } from './lib/router';
import { loadSafe, type SavedSafe } from './lib/storage';
import CreateWallet from './components/CreateWallet';
import WalletDashboard from './components/WalletDashboard';
import JoinWallet from './components/JoinWallet';
import ApproveTransaction from './components/ApproveTransaction';

export default function App() {
  const [route, setRoute] = useState<Route>(parseRoute());
  const [savedSafe, setSavedSafe] = useState<SavedSafe | null>(loadSafe());

  useEffect(() => {
    const handle = () => {
      setRoute(parseRoute());
      setSavedSafe(loadSafe());
    };
    window.addEventListener('hashchange', handle);
    return () => window.removeEventListener('hashchange', handle);
  }, []);

  const handleCreated = (safe: SavedSafe) => setSavedSafe(safe);
  const handleDisconnect = () => { setSavedSafe(null); window.location.hash = '#/'; };

  return (
    <div className="app-shell fade-in">
      {route.page === 'join' && (
        <JoinWallet safeAddress={route.safeAddress} onJoined={handleCreated} />
      )}
      {route.page === 'sign' && (
        <ApproveTransaction encodedData={route.data} />
      )}
      {route.page === 'home' && savedSafe && (
        <WalletDashboard safe={savedSafe} onDisconnect={handleDisconnect} />
      )}
      {route.page === 'home' && !savedSafe && (
        <CreateWallet onSafeCreated={handleCreated} />
      )}
    </div>
  );
}
