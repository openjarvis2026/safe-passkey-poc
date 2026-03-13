import { type Page } from '@playwright/test';

export interface VirtualAuthenticator {
  client: ReturnType<Awaited<ReturnType<Page['context']>>['newCDPSession']> extends Promise<infer T> ? T : never;
  authenticatorId: string;
}

/**
 * Set up a virtual WebAuthn authenticator via CDP.
 * This allows passkey creation and signing without real biometrics.
 */
export async function setupVirtualAuthenticator(page: Page): Promise<VirtualAuthenticator> {
  const client = await page.context().newCDPSession(page);
  await client.send('WebAuthn.enable');
  const { authenticatorId } = await client.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
    },
  });
  return { client, authenticatorId };
}

/**
 * Clean up the virtual authenticator.
 */
export async function teardownVirtualAuthenticator(auth: VirtualAuthenticator): Promise<void> {
  try {
    await auth.client.send('WebAuthn.removeVirtualAuthenticator', {
      authenticatorId: auth.authenticatorId,
    });
    await auth.client.send('WebAuthn.disable');
  } catch {
    // Ignore cleanup errors
  }
}
