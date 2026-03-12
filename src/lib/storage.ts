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

export function loadSafe(): SavedSafe | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as SavedSafe;
  } catch {
    return null;
  }
}

export function saveSafe(safe: SavedSafe): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(safe));
}

export function clearSafe(): void {
  localStorage.removeItem(STORAGE_KEY);
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
