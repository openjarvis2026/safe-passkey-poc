// Persistence layer using localStorage

export interface SavedOwner {
  address: `0x${string}`;
  publicKey: { x: string; y: string }; // hex strings
  label: string;
  credentialId?: string; // base64 rawId, only for local device
}

export interface SavedSafe {
  address: `0x${string}`;
  chainId: number;
  owners: SavedOwner[];
  threshold: number;
  deployTxHash: string;
}

const STORAGE_KEY = 'safe-passkey-poc';
const SAFES_STORAGE_KEY = 'safe-passkey-safes';
const ACTIVE_SAFE_KEY = 'safe-passkey-active';

// Legacy single-safe functions (backward compatibility)
export function loadSafe(): SavedSafe | null {
  // Check if using new multi-safe storage
  const activeSafe = getActiveSafe();
  if (activeSafe) return activeSafe;
  
  // Fall back to legacy storage
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const safe = JSON.parse(raw) as SavedSafe;
    
    // Migrate to new storage format
    const safes = { [safe.address]: safe };
    localStorage.setItem(SAFES_STORAGE_KEY, JSON.stringify(safes));
    localStorage.setItem(ACTIVE_SAFE_KEY, safe.address);
    localStorage.removeItem(STORAGE_KEY); // Clean up legacy storage
    
    return safe;
  } catch {
    return null;
  }
}

export function saveSafe(safe: SavedSafe): void {
  // Save to new multi-safe storage
  const safes = getAllSafes();
  safes[safe.address] = safe;
  localStorage.setItem(SAFES_STORAGE_KEY, JSON.stringify(safes));
  
  // Set as active Safe
  setActiveSafe(safe.address);
}

export function clearSafe(): void {
  // Remove active safe but keep others
  const activeSafeAddress = localStorage.getItem(ACTIVE_SAFE_KEY);
  if (activeSafeAddress) {
    removeSafe(activeSafeAddress as `0x${string}`);
  }
  
  // Clear legacy storage too
  localStorage.removeItem(STORAGE_KEY);
}

// New multi-safe functions
export function getAllSafes(): Record<string, SavedSafe> {
  try {
    const raw = localStorage.getItem(SAFES_STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Record<string, SavedSafe>;
  } catch {
    return {};
  }
}

export function getActiveSafe(): SavedSafe | null {
  try {
    const activeSafeAddress = localStorage.getItem(ACTIVE_SAFE_KEY);
    if (!activeSafeAddress) return null;
    
    const safes = getAllSafes();
    return safes[activeSafeAddress] || null;
  } catch {
    return null;
  }
}

export function setActiveSafe(address: `0x${string}`): void {
  localStorage.setItem(ACTIVE_SAFE_KEY, address);
}

export function removeSafe(address: `0x${string}`): void {
  const safes = getAllSafes();
  delete safes[address];
  localStorage.setItem(SAFES_STORAGE_KEY, JSON.stringify(safes));
  
  // If removing active safe, clear active reference
  const activeSafeAddress = localStorage.getItem(ACTIVE_SAFE_KEY);
  if (activeSafeAddress === address) {
    localStorage.removeItem(ACTIVE_SAFE_KEY);
  }
}

export function clearAllSafes(): void {
  localStorage.removeItem(SAFES_STORAGE_KEY);
  localStorage.removeItem(ACTIVE_SAFE_KEY);
  localStorage.removeItem(STORAGE_KEY); // Clean up legacy too
}

// Helper to convert ArrayBuffer <-> base64 for credential IDs
export function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

export function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}
