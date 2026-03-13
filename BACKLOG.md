# Simply Wallet — Backlog & Next Steps

## 🔴 Bug Fixes (Critical)

### BF-1: Pending tx stays pending after on-chain execution
**Problem:** When a cosigner executes a pending transaction, it still shows as "Pending" in Activity History. The cleanup function checks nonces but the matching may not be working correctly — the nonce from Safe Transaction Service API may not be getting through to the cleanup.
**Root cause:** `cleanupExecutedPendingTxs` relies on matching nonces, but pending txs stored in localStorage may have a different nonce format than what comes from the confirmed tx list.
**Fix:** Additionally check the on-chain Safe nonce — if Safe nonce > pending tx nonce, the pending tx was executed (or replaced). Also add a periodic poll (every 30s) to re-check pending status.
**Files:** `history.ts` (cleanup logic), `TransactionHistory.tsx` (poll interval)

### BF-2: Incoming pending txs not visible to cosigner
**Problem:** When another user creates a transaction that needs my approval, I see nothing in my dashboard. No notification, no pending section on home screen.
**Root cause:** The app only tracks pending txs that YOU created (saved to localStorage at send time). It doesn't query the Safe Transaction Service for pending/queued transactions from OTHER signers.
**Fix:** 
1. Query `GET /api/v1/safes/{address}/multisig-transactions/?executed=false` for unexecuted txs
2. Show a "Pending Approval" section on the dashboard (above Recent Activity)
3. Each pending item shows: who proposed it, what it does (send X ETH to Y), and an "Approve" button
4. On approval, navigate to the ApproveTransaction flow
**Files:** `history.ts` (new `fetchPendingApprovals()`), `WalletDashboard.tsx` (new section)

### BF-3: Transactions/balances disappear on refresh
**Problem:** After refresh, some transactions vanish from history and balances flicker or show 0 momentarily.
**Root causes:**
1. Safe Transaction Service API is unreliable for Base Sepolia custom Safes — sometimes returns empty
2. No caching layer — every page load makes fresh API calls
3. Balance uses multicall which can fail on RPC throttling
4. localStorage cache only has txs YOU sent, not all txs
**Fix:**
1. Cache the last successful API response in localStorage with TTL (5 min)
2. Show cached data immediately, then update with fresh data (stale-while-revalidate)
3. Add retry logic (3 attempts with exponential backoff) for both Safe API and RPC calls
4. Show skeleton/shimmer instead of empty state while loading
**Files:** `history.ts`, `tokens.ts`, `WalletDashboard.tsx`

### BF-4: Remove SignerSwitch modal (broken/discontinued)
**Problem:** The "Switch Signer Type" feature is broken and discontinued. The modal still exists in code and can be accessed from Settings.
**Fix:** Remove `SignerSwitch.tsx` component, remove import and usage from `Settings.tsx`, remove the button that opens it.
**Files:** `Settings.tsx`, `SignerSwitch.tsx` (delete), both `staging` and `main` branches

## 🟠 Feature Additions

### FA-1: "Pending Approval" section on Dashboard
Show pending transactions from ALL signers (not just yours) that need your signature. This is the key multi-sig UX element that's currently missing.
- Show count badge: "2 actions need your approval"
- Each item: type icon, description, proposer, "Review" button
- Includes: sends, threshold changes, owner changes
**Priority:** HIGH — core multi-sig functionality

### FA-2: Threshold changes in Activity History
Threshold changes should appear as proper items in Activity History.
- Show: "Threshold changed from 1 to 2" with 🔒 icon
- Include who initiated and when
- Already partially implemented (type detection exists) — needs proper rendering with decoded data
**Priority:** MEDIUM

### FA-3: Spending/Action categories in Activity History  
Group activities by type: Transfers, Security Changes, Pending
- Tab or filter buttons: "All | Transfers | Security | Pending"
- Better visual distinction between sends, receives, threshold changes, owner changes
**Priority:** LOW

## 🟡 UX Improvements

### UX-1: Receive screen redesign
Current receive screen is basic. Improve:
- Larger QR code (prominent, centered)
- Subtle animation on QR code appearance
- "Share" button more prominent (primary style)
- Show wallet name ("My Wallet") above QR
- Copy button with clear feedback animation

### UX-2: Add Device flow simplification
Current flow has too many steps/buttons. Audit the InviteSigner flow and reduce by at least 1 step:
- Combine "Generate Link" + "Copy Link" into one action
- Auto-copy on generation
- Show the link with a single "Share" button
- Consider: can we use Web Share API directly?

### UX-3: Mobile layout audit
Full pass on all screens at 320px-428px viewport:
- Check text overflow on long addresses
- Check button tap targets (min 44x44px)
- Check scroll behavior on small screens
- Check keyboard behavior (inputs shouldn't be covered)
- Check landscape orientation

### UX-4: Loading & empty states consistency
Standardize across all views:
- Loading: centered spinner + "Loading..." text (not just spinner)
- Empty: helpful illustration/icon + actionable message
- Error: red card with retry button
- Skeleton loading for balance and token list

### UX-5: Visual feedback & animations
Add micro-interactions:
- Button press feedback (scale down slightly)
- Page transitions (slide in/out)
- Success animations (checkmark circle)
- Balance update flash (subtle highlight on change)

## 🔵 Resilience Assessment

### R-1: RPC reliability
**Issue:** Single RPC endpoint (`https://sepolia.base.org`) with no fallback.
**Fix:** Add 2-3 fallback RPCs and rotate on failure:
- `https://base-sepolia-rpc.publicnode.com`
- `https://sepolia.base.org`
- `https://base-sepolia.blockpi.network/v1/rpc/public`

### R-2: Safe Transaction Service reliability
**Issue:** The Safe TX Service for Base Sepolia is unreliable. Returns empty results randomly.
**Fix:** 
1. Stale-while-revalidate pattern (show cached, update in background)
2. Retry with backoff on empty results
3. Don't overwrite good cached data with empty API response

### R-3: No error boundaries
**Issue:** A single API failure can crash the whole app (white screen).
**Fix:** Add React Error Boundaries around each major section (Balance, TokenList, RecentActivity, SwapView). Each shows its own error state without crashing others.

### R-4: Balance race conditions
**Issue:** Multiple `getBalance` calls can return in different order, causing flicker.
**Fix:** Use request IDs or abort controllers. Only apply the most recent result.

### R-5: localStorage corruption
**Issue:** If localStorage gets corrupted (invalid JSON), the app may crash on load.
**Fix:** Wrap all `JSON.parse(localStorage.getItem(...))` in try-catch with fallback to default values. (Partially done, but audit all callsites.)

---

## 📊 Priority Matrix

| ID | Type | Priority | Effort | Impact |
|----|------|----------|--------|--------|
| BF-1 | Bug | 🔴 Critical | S | High |
| BF-2 | Bug | 🔴 Critical | M | High |
| BF-3 | Bug | 🔴 Critical | M | High |
| BF-4 | Bug | 🔴 Critical | XS | Low |
| FA-1 | Feature | 🟠 High | L | High |
| FA-2 | Feature | 🟠 Medium | S | Medium |
| FA-3 | Feature | 🟡 Low | M | Low |
| UX-1 | UX | 🟡 Medium | S | Medium |
| UX-2 | UX | 🟡 Medium | S | Medium |
| UX-3 | UX | 🟡 Medium | M | Medium |
| UX-4 | UX | 🟡 Low | M | Low |
| UX-5 | UX | 🟢 Low | M | Low |
| R-1 | Resilience | 🟠 High | S | High |
| R-2 | Resilience | 🟠 High | M | High |
| R-3 | Resilience | 🟡 Medium | S | Medium |
| R-4 | Resilience | 🟡 Medium | S | Medium |
| R-5 | Resilience | 🟢 Low | XS | Low |

---

## 🌳 Proposed Execution Tree

### Wave A — Critical Bugs (parallel)
| Minion | Items | Est |
|--------|-------|-----|
| A1 | BF-1 (pending status fix) + BF-4 (remove SignerSwitch) | 10 min |
| A2 | BF-2 (incoming pending txs) + FA-1 (Pending Approval section) | 20 min |
| A3 | BF-3 (caching + retry) + R-1 (RPC fallbacks) + R-2 (API caching) | 15 min |

→ QA + screenshots + preview → Augusto approval

### Wave B — UX + Features (parallel)
| Minion | Items | Est |
|--------|-------|-----|
| B1 | UX-1 (receive redesign) + UX-2 (add device simplification) | 15 min |
| B2 | FA-2 (threshold in history with decoded data) + FA-3 (activity filters) | 15 min |
| B3 | R-3 (error boundaries) + R-4 (race conditions) + UX-4 (loading states) | 15 min |

→ QA + screenshots + preview → Augusto approval

### Wave C — Final Polish
| Minion | Items | Est |
|--------|-------|-----|
| C1 | UX-3 (mobile audit) + UX-5 (animations) + R-5 (localStorage safety) | 15 min |
| C2 | E2E test updates for all new flows | 10 min |

→ Final QA → merge to main
