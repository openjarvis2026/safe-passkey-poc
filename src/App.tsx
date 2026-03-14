import { useState, useEffect } from 'react';
import { parseRoute, type Route } from './lib/router';
import { loadSafe, getActiveSafe, getAllSafes, type SavedSafe } from './lib/storage';
import CreateWallet from './components/CreateWallet';
import WalletDashboard from './components/WalletDashboard';
import JoinWallet from './components/JoinWallet';
import ApproveTransaction from './components/ApproveTransaction';
import Settings from './components/Settings';
import InviteSigner from './components/InviteSigner';
import SignersView from './components/SignersView';

export default function App() {
  const [route, setRoute] = useState<Route>(parseRoute());
  const [savedSafe, setSavedSafe] = useState<SavedSafe | null>(null);
  const [hasCheckedSafes, setHasCheckedSafes] = useState(false);

  useEffect(() => {
    // On initial load, check for existing safes
    const checkExistingSafes = () => {
      const allSafes = getAllSafes();
      const safeAddresses = Object.keys(allSafes);
      
      if (safeAddresses.length > 0) {
        // If there's an active safe, use it
        let activeSafe = getActiveSafe();
        
        // If no active safe but we have safes, use the first one
        if (!activeSafe && safeAddresses.length > 0) {
          activeSafe = allSafes[safeAddresses[0]];
        }
        
        setSavedSafe(activeSafe);
      } else {
        // Fall back to legacy storage check
        const legacySafe = loadSafe();
        setSavedSafe(legacySafe);
      }
      
      setHasCheckedSafes(true);
    };

    if (!hasCheckedSafes) {
      checkExistingSafes();
    }

    const handle = () => {
      setRoute(parseRoute());
      // Update saved safe on hash change (in case of navigation)
      if (hasCheckedSafes) {
        const activeSafe = getActiveSafe();
        setSavedSafe(activeSafe);
      }
    };
    
    window.addEventListener('hashchange', handle);
    return () => window.removeEventListener('hashchange', handle);
  }, [hasCheckedSafes]);

  const handleCreated = (safe: SavedSafe) => setSavedSafe(safe);
  
  const handleDisconnect = () => { 
    setSavedSafe(null); 
    window.location.hash = '#/'; 
  };

  const handleSafeChanged = (safe: SavedSafe | null) => {
    setSavedSafe(safe);
    if (!safe) {
      // If no safe selected, check if any other safes exist
      const allSafes = getAllSafes();
      const safeAddresses = Object.keys(allSafes);
      if (safeAddresses.length > 0) {
        // Switch to first available safe
        setSavedSafe(allSafes[safeAddresses[0]]);
      } else {
        // No safes left, go to home
        window.location.hash = '#/';
      }
    }
  };

  // Show loading state while checking for safes
  if (!hasCheckedSafes) {
    return (
      <div className="app-shell fade-in" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh' }}>
        <div className="spinner spinner-dark" style={{ width: 40, height: 40 }} />
      </div>
    );
  }

  return (
    <div className="app-shell fade-in">
      {route.page === 'join' && (
        <JoinWallet safeAddress={route.safeAddress} onJoined={handleCreated} />
      )}
      {route.page === 'sign' && (
        <ApproveTransaction encodedData={route.data} />
      )}
      {route.page === 'settings' && savedSafe && (
        <Settings safe={savedSafe} onBack={() => window.location.hash = '#/'} />
      )}
      {route.page === 'signers' && savedSafe && (
        <SignersView safe={savedSafe} onBack={() => window.location.hash = '#/'} />
      )}
      {route.page === 'invite' && savedSafe && route.safeAddress === savedSafe.address && (
        <InviteSigner safe={savedSafe} onBack={() => window.location.hash = '#/'} />
      )}
      {route.page === 'home' && savedSafe && (
        <WalletDashboard safe={savedSafe} onDisconnect={handleDisconnect} onSafeChanged={handleSafeChanged} />
      )}
      {route.page === 'home' && !savedSafe && (
        <CreateWallet onSafeCreated={handleCreated} />
      )}
    </div>
  );
}
