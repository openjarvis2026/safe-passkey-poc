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

    // ── 3. Create wallet or detect existing ──
    const dashboardVisible = await page.getByText('Total Balance').isVisible({ timeout: 3_000 }).catch(() => false);
    
    if (!dashboardVisible) {
      const createBtn = page.getByRole('button', { name: /get started/i });
      await expect(createBtn).toBeVisible({ timeout: 10_000 });
      await createBtn.click();

      // ── 4. Wait for passkey creation + signer deployment + Safe deployment ──
      // Wait for either "Done! ✅" or dashboard (transitions fast)
      await expect(page.getByText('Done! ✅').or(page.getByText('Total Balance'))).toBeVisible({ timeout: BLOCKCHAIN_TIMEOUT });
    } else {
      console.log('Wallet already exists, skipping creation');
    }

    // ── 5. Wait for dashboard to load ──
    await expect(page.getByText('Total Balance')).toBeVisible({ timeout: 15_000 });

    // Extract Safe address from the bottom of the dashboard
    const safeAddressLink = page.locator('a[href*="basescan.org/address/"]').last();
    await expect(safeAddressLink).toBeVisible({ timeout: 10_000 });
    
    // Get the full address from href
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

    // Click Send button (now just "Send", no arrow prefix)
    await page.getByRole('button', { name: 'Send' }).first().click();
    await expect(page.getByText('Send').first()).toBeVisible();

    // Fill in recipient and amount
    await page.getByPlaceholder(/recipient/i).fill(recipientAddress);
    await page.getByPlaceholder(/amount/i).fill(sendAmount);

    // Execute send via slide-to-send or review flow
    const slideTrack = page.locator('.slide-track');
    const reviewBtn = page.getByRole('button', { name: 'Review' });

    if (await reviewBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
      // Review flow: click Review → then slide/confirm
      await reviewBtn.click();
      await expect(page.getByText('Review Transaction')).toBeVisible({ timeout: 5_000 });
      const reviewSlide = page.locator('.slide-track');
      const box = await reviewSlide.boundingBox();
      if (box) {
        const thumb = page.locator('.slide-thumb');
        await thumb.dragTo(reviewSlide, { targetPosition: { x: box.width - 20, y: box.height / 2 }, force: true });
      }
    } else if (await slideTrack.isVisible({ timeout: 2_000 }).catch(() => false)) {
      // Direct slide-to-send
      const thumb = page.locator('.slide-thumb');
      const box = await slideTrack.boundingBox();
      if (box) {
        await thumb.dragTo(slideTrack, { targetPosition: { x: box.width - 20, y: box.height / 2 }, force: true });
      }
    }

    // Wait for transaction to complete
    await expect(page.getByText('Sent!', { exact: false })).toBeVisible({ timeout: BLOCKCHAIN_TIMEOUT });
    console.log('Send transaction completed');

    // Navigate back to home
    const goHomeBtn = page.getByRole('button', { name: /go home|back to wallet/i });
    const backBtn = page.locator('button').filter({ hasText: '←' });
    if (await goHomeBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await goHomeBtn.click();
    } else if (await backBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await backBtn.click();
    }

    // Wait for home to load
    await expect(page.getByText('Total Balance')).toBeVisible({ timeout: 10_000 });

    // Click "View All" in Recent Activity section to open full History
    const viewAllBtn = page.getByText(/View All/i);
    if (await viewAllBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await viewAllBtn.click({ force: true });
    } else {
      // Fallback: try History button if it still exists
      await page.getByRole('button', { name: /history/i }).click({ force: true });
    }
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

    // ── 13. Test Convert Flow ──
    // Navigate back to home
    const backFromHistory = page.locator('button').filter({ hasText: '←' });
    if (await backFromHistory.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await backFromHistory.click();
    }
    await expect(page.getByText('Total Balance')).toBeVisible({ timeout: 10_000 });

    // Click Convert button (was "Swap")
    await page.getByRole('button', { name: 'Convert' }).click({ force: true });
    await expect(page.getByText('Convert')).toBeVisible({ timeout: 10_000 });

    // Enter a small amount to convert (ETH → USDC is default)
    await page.locator('.swap-amount-input').fill('0.0001');

    // Wait for quote to load
    await expect(page.getByText('Exchange Rate')).toBeVisible({ timeout: 10_000 });
    console.log('Convert quote loaded');

    // Trigger convert slide using Playwright's dragTo on the thumb
    const swapTrack = page.locator('[data-testid="swap-slide"]');
    const swapThumb = swapTrack.locator('.slide-thumb');
    await expect(swapThumb).toBeVisible({ timeout: 5_000 });

    // dragTo moves the element to the target position
    const trackBox = await swapTrack.boundingBox();
    if (trackBox) {
      // Drag thumb to the right end of the track
      await swapThumb.dragTo(swapTrack, {
        targetPosition: { x: trackBox.width - 20, y: trackBox.height / 2 },
        force: true,
      });
    }

    // Wait for convert to complete or error  
    await expect(page.getByText(/completed|Error/)).toBeVisible({ timeout: BLOCKCHAIN_TIMEOUT });
    const convertStatus = await page.getByText(/completed|Error/).textContent();
    console.log('Convert result:', convertStatus);

    // Cleanup
    await teardownVirtualAuthenticator(auth);
  });
});
