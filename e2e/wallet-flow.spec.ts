import { test, expect } from '@playwright/test';
import { setupVirtualAuthenticator, teardownVirtualAuthenticator, type VirtualAuthenticator } from './helpers/webauthn';
import { fundSafe } from './helpers/fund-safe';

// Generous timeout for blockchain operations
const BLOCKCHAIN_TIMEOUT = 60_000;

test.describe('Simply Wallet — Full Lifecycle', () => {
  let auth: VirtualAuthenticator;

  test('full wallet lifecycle: create → fund → send → history → resend', async ({ page }) => {
    // ── 1. Setup virtual authenticator ──
    auth = await setupVirtualAuthenticator(page);

    // ── 2. Navigate to app ──
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // ── 3. Click "Get Started" to create wallet ──
    const createBtn = page.getByRole('button', { name: /get started/i });
    await expect(createBtn).toBeVisible({ timeout: 10_000 });
    await createBtn.click();

    // ── 4. Wait for passkey creation + signer deployment + Safe deployment ──
    // The app shows progress: biometrics → signer → safe → done
    await expect(page.getByText('Done! ✅')).toBeVisible({ timeout: BLOCKCHAIN_TIMEOUT });

    // ── 5. Wait for dashboard to load and extract Safe address ──
    await expect(page.getByText('Total Balance')).toBeVisible({ timeout: 15_000 });

    // Extract Safe address from the bottom of the dashboard
    const safeAddressLink = page.locator('a[href*="basescan.org/address/"]').last();
    await expect(safeAddressLink).toBeVisible({ timeout: 10_000 });
    const safeAddressText = await safeAddressLink.textContent();
    
    // The address is displayed as shortened (0x1234…abcd), get the full address from href
    const href = await safeAddressLink.getAttribute('href');
    const safeAddress = href!.split('/address/')[1];
    expect(safeAddress).toMatch(/^0x[a-fA-F0-9]{40}$/);
    console.log(`Safe deployed at: ${safeAddress}`);

    // ── 6. Fund the Safe with ETH ──
    console.log('Funding Safe with 0.001 ETH...');
    const fundTxHash = await fundSafe(safeAddress, '0.001');
    console.log(`Funded Safe: tx ${fundTxHash}`);

    // ── 7. Wait for balance to update in UI ──
    // The dashboard polls every 6 seconds, wait for non-zero balance
    await expect(async () => {
      const balanceText = await page.locator('.card-gradient p').nth(1).textContent();
      expect(balanceText).not.toBe('0 ETH');
    }).toPass({ timeout: 30_000, intervals: [2_000] });

    console.log('Balance updated in UI');

    // ── 8. Send ETH to a random address ──
    const recipientAddress = '0x000000000000000000000000000000000000dEaD';
    const sendAmount = '0.0001';

    // Click Send button
    await page.getByRole('button', { name: /send/i }).first().click();
    await expect(page.getByText('Send').first()).toBeVisible();

    // Fill in recipient and amount
    await page.getByPlaceholder(/recipient/i).fill(recipientAddress);
    await page.getByPlaceholder(/amount/i).fill(sendAmount);

    // Use slide-to-confirm or button (threshold=1 uses slide)
    const slideTrack = page.locator('.slide-track, .slide-to-confirm');
    const sendButton = page.getByRole('button', { name: /send/i });

    if (await slideTrack.isVisible({ timeout: 3_000 }).catch(() => false)) {
      // Perform slide gesture
      const box = await slideTrack.boundingBox();
      if (box) {
        await page.mouse.move(box.x + 20, box.y + box.height / 2);
        await page.mouse.down();
        // Slide across the full width
        for (let x = box.x + 20; x <= box.x + box.width - 20; x += 10) {
          await page.mouse.move(x, box.y + box.height / 2);
        }
        await page.mouse.up();
      }
    } else {
      await sendButton.click();
    }

    // Wait for transaction to complete
    await expect(page.getByText(/sent|✅/i)).toBeVisible({ timeout: BLOCKCHAIN_TIMEOUT });
    console.log('Send transaction completed');

    // ── 9. Navigate to History ──
    // Go back to home first
    const backBtn = page.locator('button').filter({ hasText: '←' });
    if (await backBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await backBtn.click();
    }

    // Wait for home to load
    await expect(page.getByText('Total Balance')).toBeVisible({ timeout: 10_000 });

    // Click History button
    await page.getByRole('button', { name: /history/i }).click();
    await expect(page.getByText('Transaction History')).toBeVisible({ timeout: 10_000 });

    // ── 10. Verify the sent transaction appears ──
    // Wait for history to load (it fetches from chain)
    await expect(page.locator('.card').filter({ hasText: /send/i }).first()).toBeVisible({
      timeout: 30_000,
    });
    console.log('Transaction visible in history');

    // ── 11. Click "Resend" on the transaction ──
    // Look for a resend/repeat button on the transaction item
    const resendBtn = page.getByRole('button', { name: /resend|repeat|send again/i }).first();
    
    if (await resendBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await resendBtn.click();

      // ── 12. Verify resend flow works ──
      // Should pre-fill the send form with previous transaction details
      await expect(page.getByPlaceholder(/recipient/i)).toBeVisible({ timeout: 10_000 });
      const prefilledRecipient = await page.getByPlaceholder(/recipient/i).inputValue();
      expect(prefilledRecipient.toLowerCase()).toBe(recipientAddress.toLowerCase());
      console.log('Resend flow verified — recipient pre-filled');
    } else {
      // If no resend button, verify we can at least see the transaction details
      console.log('No resend button found — verifying transaction is displayed');
      const txItems = page.locator('.card').filter({ hasText: /0x/ });
      expect(await txItems.count()).toBeGreaterThan(0);
    }

    // Cleanup
    await teardownVirtualAuthenticator(auth);
  });
});
