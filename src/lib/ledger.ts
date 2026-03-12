import TransportWebHID from '@ledgerhq/hw-transport-webhid';
import Eth from '@ledgerhq/hw-app-eth';

export interface LedgerDevice {
  transport: any;
  eth: Eth;
  address: `0x${string}`;
  deviceInfo: string;
}

export interface LedgerConnectionState {
  status: 'idle' | 'connecting' | 'connected' | 'error';
  device?: LedgerDevice;
  error?: string;
}

// Default Ethereum derivation path: m/44'/60'/0'/0/0
const DEFAULT_DERIVATION_PATH = "44'/60'/0'/0/0";

/**
 * Connect to Ledger device using WebHID transport
 * Attempts to connect, open Ethereum app, and get the default address
 */
export async function connectLedger(): Promise<LedgerDevice> {
  let transport;
  
  try {
    // Check if WebHID is supported
    if (!('hid' in navigator)) {
      throw new Error('WebHID is not supported in this browser. Please use Chrome/Edge/Opera.');
    }

    // Try to connect using WebHID
    transport = await TransportWebHID.create();
    
    // Create Ethereum app instance
    const eth = new Eth(transport);
    
    // Test connection by getting the app configuration
    try {
      await eth.getAppConfiguration();
    } catch (error) {
      throw new Error('Please open the Ethereum app on your Ledger device');
    }
    
    // Get Ethereum address from default derivation path
    const result = await eth.getAddress(DEFAULT_DERIVATION_PATH, false);
    const address = result.address as `0x${string}`;
    
    // Get device info for display
    const deviceInfo = await getDeviceInfo(transport);
    
    return {
      transport,
      eth,
      address,
      deviceInfo,
    };
  } catch (error: any) {
    // Clean up transport if connection failed
    if (transport) {
      try {
        await transport.close();
      } catch (closeError) {
        console.warn('Failed to close transport:', closeError);
      }
    }
    
    // Provide user-friendly error messages
    if (error.message.includes('No device selected')) {
      throw new Error('Please connect your Ledger device and grant permission');
    }
    if (error.message.includes('UNKNOWN_ERROR (0x6804)')) {
      throw new Error('Please unlock your Ledger device');
    }
    if (error.message.includes('CLA_NOT_SUPPORTED (0x6e00)')) {
      throw new Error('Please open the Ethereum app on your Ledger device');
    }
    if (error.message.includes('INS_NOT_SUPPORTED (0x6d00)')) {
      throw new Error('Please open the Ethereum app on your Ledger device');
    }
    
    throw error;
  }
}

/**
 * Sign a transaction hash with the Ledger device
 */
export async function signTransactionHash(
  device: LedgerDevice,
  txHash: Uint8Array
): Promise<{ r: string; s: string; v: number }> {
  try {
    // Convert hash to hex string (without 0x prefix for Ledger)
    const hashHex = Array.from(txHash)
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
    
    // Sign the hash directly
    const result = await device.eth.signPersonalMessage(DEFAULT_DERIVATION_PATH, hashHex);
    
    // Return signature components
    return {
      r: '0x' + result.r,
      s: '0x' + result.s,
      v: result.v,
    };
  } catch (error: any) {
    if (error.message.includes('Transaction rejected')) {
      throw new Error('Transaction rejected on device');
    }
    if (error.message.includes('User rejected')) {
      throw new Error('Transaction rejected on device');
    }
    
    throw new Error(`Failed to sign transaction: ${error.message}`);
  }
}

/**
 * Disconnect and clean up Ledger device
 */
export async function disconnectLedger(device: LedgerDevice): Promise<void> {
  try {
    await device.transport.close();
  } catch (error) {
    console.warn('Failed to close Ledger transport:', error);
    // Don't throw - disconnection errors are not critical
  }
}

/**
 * Get device information for display
 */
async function getDeviceInfo(transport: any): Promise<string> {
  try {
    // Try to get device name and model info
    if (transport.device && transport.device.productName) {
      return transport.device.productName;
    }
    
    // Fallback to generic Ledger device
    return 'Ledger Hardware Wallet';
  } catch (error) {
    return 'Ledger Device';
  }
}

/**
 * Check if WebHID is available and supported
 */
export function isLedgerSupported(): boolean {
  return typeof navigator !== 'undefined' && 'hid' in navigator;
}

/**
 * Get user-friendly error message for common Ledger errors
 */
export function getLedgerErrorMessage(error: any): string {
  const message = error.message || error.toString();
  
  if (message.includes('No device selected')) {
    return 'Connect your Ledger and grant permission';
  }
  if (message.includes('UNKNOWN_ERROR (0x6804)')) {
    return 'Please unlock your Ledger device';
  }
  if (message.includes('CLA_NOT_SUPPORTED') || message.includes('INS_NOT_SUPPORTED')) {
    return 'Open the Ethereum app on your Ledger';
  }
  if (message.includes('Transaction rejected') || message.includes('User rejected')) {
    return 'Transaction rejected on device';
  }
  if (message.includes('WebHID is not supported')) {
    return 'Use Chrome, Edge, or Opera browser';
  }
  
  return `Ledger error: ${message}`;
}