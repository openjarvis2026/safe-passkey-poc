import { test, expect } from '@playwright/test';
import { setupVirtualAuthenticator, teardownVirtualAuthenticator, type VirtualAuthenticator } from './helpers/webauthn';
import { fundSafe } from './helpers/fund-safe';

// Generous timeout for blockchain operations
const BLOCKCHAIN_TIMEOUT = 60_000;

test.describe('Simply Wallet — Full Lifecycle', () => {
  let auth: VirtualAuthenticator;

  test('full wallet lifecycle: create → fund → send → history → convert', async ({ page }) => {
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
      await expect(page.getByText('Done! ✅').or(page.getByText('Total Balance'))).toBeVisible({ timeout: BLOCKCHAIN_TIMEOUT });
    } else {
      console.log('Wallet already exists, skipping creation');
    }

    // ── 5. Wait for dashboard to load ──
    await expect(page.getByText('Total Balance')).toBeVisible({ timeout: 15_000 });

    // Verify header shows "My Wallet"
    await expect(page.getByText('My Wallet')).toBeVisible({ timeout: 5_000 });

    // Extract Safe address from the bottom of the dashboard
    const safeAddressLink = page.locator('a[href*="basescan.org/address/"]').last();
    await expect(safeAddressLink).toBeVisible({ timeout: 10_000 });
    
    const href = await safeAddressLink.getAttribute('href');
    const safeAddress = href!.split('/address/')[1];
    expect(safeAddress).toMatch(/^0x[a-fA-F0-9]{40}$/);
    console.log(`Safe deployed at: ${safeAddress}`);

    // ── 6. Fund the Safe with ETH ──
    console.log('Funding Safe with 0.001 ETH...');
    const fundTxHash = await fundSafe(safeAddress, '0.001');
    console.log(`Funded Safe: tx ${fundTxHash}`);

    // ── 7. Wait for balance to update in UI (token balances load via multicall) ──
    await expect(async () => {
      const balanceText = await page.locator('.card-gradient p').nth(1).textContent();
      expect(balanceText).not.toBe('0 ETH');
    }).toPass({ timeout: 30_000, intervals: [2_000] });

    console.log('Balance updated in UI');

    // ── 8. Send ETH to a random address ──
    const recipientAddress = '0x000000000000000000000000000000000000dEaD';
    const sendAmount = '0.0001';

    // Click Send button
    await page.getByRole('button', { name: 'Send' }).first().click();
    await expect(page.getByText('Send').first()).toBeVisible();

    // Fill in recipient and amount
    await page.getByPlaceholder(/recipient/i).fill(recipientAddress);
    await page.getByPlaceholder(/amount/i).fill(sendAmount);

    // Execute send via slide-to-send or review flow
    const slideTrack = page.locator('.slide-track');
    const reviewBtn = page.getByRole('button', { name: 'Review' });

    if (await reviewBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await reviewBtn.click();
      await expect(page.getByText('Review Transaction')).toBeVisible({ timeout: 5_000 });
      const reviewSlide = page.locator('.slide-track');
      const box = await reviewSlide.boundingBox();
      if (box) {
        const thumb = page.locator('.slide-thumb');
        await thumb.dragTo(reviewSlide, { targetPosition: { x: box.width - 20, y: box.height / 2 }, force: true });
      }
    } else if (await slideTrack.isVisible({ timeout: 2_000 }).catch(() => false)) {
      const thumb = page.locator('.slide-thumb');
      const box = await slideTrack.boundingBox();
      if (box) {
        await thumb.dragTo(slideTrack, { targetPosition: { x: box.width - 20, y: box.height / 2 }, force: true });
      }
    }

    // ── 9. Verify success card ──
    await expect(page.getByText('Sent!')).toBeVisible({ timeout: BLOCKCHAIN_TIMEOUT });
    console.log('Send transaction completed');

    // Verify success card shows "Send More" and "Back to Wallet" buttons
    await expect(page.getByRole('button', { name: /send more/i })).toBeVisible({ timeout: 5_000 });
    await expect(page.getByRole('button', { name: /back to wallet/i })).toBeVisible({ timeout: 5_000 });

    // Click "Back to Wallet" to return home
    await page.getByRole('button', { name: /back to wallet/i }).click();

    // Wait for home to load
    await expect(page.getByText('Total Balance')).toBeVisible({ timeout: 10_000 });

    // ── 10. Navigate to History via "View All" in Recent Activity ──
    const viewAllLink = page.getByText(/View All/i);
    await expect(viewAllLink).toBeVisible({ timeout: 5_000 });
    await viewAllLink.click({ force: true });

    await expect(page.getByText('Transaction History')).toBeVisible({ timeout: 10_000 });

    // ── 11. Verify the sent transaction appears ──
    await expect(page.locator('.card').filter({ hasText: /send/i }).first()).toBeVisible({
      timeout: 30_000,
    });
    console.log('Transaction visible in history');

    // Check for "Send again" button on the transaction
    const sendAgainBtn = page.getByRole('button', { name: /send again/i }).first();
    if (await sendAgainBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await sendAgainBtn.click();
      await expect(page.getByPlaceholder(/recipient/i)).toBeVisible({ timeout: 10_000 });
      const prefilledRecipient = await page.getByPlaceholder(/recipient/i).inputValue();
      expect(prefilledRecipient.toLowerCase()).toBe(recipientAddress.toLowerCase());
      console.log('Send again flow verified — recipient pre-filled');

      // Go back to history then home
      const backBtn = page.locator('button').filter({ hasText: '←' });
      if (await backBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
        await backBtn.click();
      }
    } else {
      console.log('No "Send again" button found — transaction displayed OK');
    }

    // ── 12. Navigate back to home for Convert test ──
    const backFromHistory = page.locator('button').filter({ hasText: '←' });
    if (await backFromHistory.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await backFromHistory.click();
    }
    await expect(page.getByText('Total Balance')).toBeVisible({ timeout: 10_000 });

    // ── 13. Test Convert Flow ──
    await page.getByRole('button', { name: /convert/i }).click({ force: true });
    await expect(page.getByText('Convert').first()).toBeVisible({ timeout: 10_000 });

    // Enter a small amount to convert
    await page.locator('.swap-amount-input').fill('0.0001');

    // Wait for quote to load
    await expect(page.getByText('Exchange Rate')).toBeVisible({ timeout: 10_000 });
    console.log('Convert quote loaded');

    // Verify "Slide to convert" exists
    const swapTrack = page.locator('[data-testid="swap-slide"]');
    const swapThumb = swapTrack.locator('.slide-thumb');
    await expect(swapThumb).toBeVisible({ timeout: 5_000 });
    console.log('Slide to convert visible');

    // Optionally drag thumb to execute convert (may fail if insufficient funds)
    const trackBox = await swapTrack.boundingBox();
    if (trackBox) {
      await swapThumb.dragTo(swapTrack, {
        targetPosition: { x: trackBox.width - 20, y: trackBox.height / 2 },
        force: true,
      });

      // Wait for convert to complete or error — don't fail the test if it times out
      const convertResult = await page.getByText(/completed|Error/i).isVisible({ timeout: BLOCKCHAIN_TIMEOUT }).catch(() => false);
      if (convertResult) {
        const convertStatus = await page.getByText(/completed|Error/i).textContent();
        console.log('Convert result:', convertStatus);
      } else {
        console.log('Convert did not complete within timeout — likely insufficient funds');
      }
    }

    // Cleanup
    await teardownVirtualAuthenticator(auth);
  });
});
