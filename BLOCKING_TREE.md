# 🌳 Blocking Tree — Simply Wallet

> Task dependency graph. Tasks at the same level with no arrows between them can run in parallel.
> Each task has an Implementation Plan below.

## Dependency Graph

```
T1: Multi-Token Balances ──────────┐
                                   ├──→ T4: Transaction History ──→ T5: Re-send from History
T2: Gas Abstraction UX             │
                                   │
T3: Session Persistence ───────────┤
                                   │
                                   ├──→ T6: Uniswap Swaps + Fee
                                   │
                                   ├──→ T7: Chain Abstraction (Across)
                                   │
T8: Settings / Signer Management ──┤
                                   └──→ T9: Add Signer Flow (improved)

T10: ENS Subdomains (standalone, Phase 4 — deferred)
T11: Ledger Integration (real) ──── depends on T8
```

## Parallelism Map

### Wave 1 (no dependencies — can all run simultaneously)
- **T1**: Multi-Token Balances
- **T2**: Gas Abstraction UX
- **T3**: Session Persistence (localStorage improvements)
- **T8**: Settings / Signer Management

### Wave 2 (depends on Wave 1)
- **T4**: Transaction History (needs T1 for token display)
- **T9**: Add Signer Flow (needs T8 for signer management logic)
- **T11**: Ledger Integration (needs T8 for SignerSwitch UI)

### Wave 3 (depends on Waves 1+2)
- **T5**: Re-send from History (needs T4)
- **T6**: Uniswap Swaps + Fee (needs T1 for token selection)
- **T11b**: Ledger Transaction Signing + Address Selector (needs T11)
- ~~**T7**: Chain Abstraction (needs T1 + T3)~~ **⏸️ PAUSED**

### Wave 4 — UI Validation (final phase before Done)
- **T12**: Playwright E2E Test Suite — all critical user flows
- **T13**: UI Polish Pass — automated visual regression + consistency audit
- **T14**: Human QA — manual testing on real devices → bug fix cycle → sign off

### Paused / Deferred
- ~~**T7**: Chain Abstraction~~ ⏸️
- ~~**T10**: ENS Subdomains~~ ⏸️

---

## Implementation Plans

---

### T1: Multi-Token Balances

**Context:** Currently the dashboard only shows ETH balance. Need to display ERC-20 token balances and enable token selection in the send flow.

**Files to create:**
- `src/lib/tokens.ts` — Token list (address, symbol, decimals, logoURI), balance fetching via multicall, USD pricing
- `src/components/TokenList.tsx` — Token balance list component for dashboard
- `src/components/TokenSelector.tsx` — Token picker for send flow (dropdown or bottom sheet)

**Files to modify:**
- `src/components/WalletDashboard.tsx` — Replace single ETH balance with TokenList, integrate TokenSelector in send flow
- `src/lib/safe.ts` — Add `encodeERC20Transfer()` function for token sends
- `src/styles.css` — Styles for token list items, token selector

**Acceptance Criteria:**
- [ ] Dashboard shows ETH + at least USDC, USDT, WETH balances
- [ ] Each token shows balance and USD value
- [ ] Send flow allows selecting which token to send
- [ ] ERC-20 transfers execute correctly through the Safe
- [ ] Zero-balance tokens are shown but greyed out
- [ ] Prices fetched from a free API (CoinGecko or DeFiLlama)

**Out of scope:**
- Custom token import (T10+)
- Token logos from on-chain metadata

---

### T2: Gas Abstraction UX

**Context:** The relayer already pays gas, but some UI elements may still reference gas. This task ensures the UX is fully gas-abstracted — user never sees "gas", "fee", or "wei".

**Files to modify:**
- `src/components/WalletDashboard.tsx` — Remove any gas references in send flow, ensure "Send" feels like Venmo
- `src/components/ApproveTransaction.tsx` — Remove gas-related info from tx approval display
- `src/components/CreateWallet.tsx` — Ensure wallet creation shows no gas info
- `src/styles.css` — Any gas-related UI cleanup

**Acceptance Criteria:**
- [ ] No mention of "gas", "fee", "gwei", or "wei" anywhere in the UI
- [ ] Send flow shows only: recipient, amount, token — nothing else
- [ ] Transaction confirmation shows only: to, amount, token, status
- [ ] Wallet creation flow mentions no blockchain/gas concepts

**Out of scope:**
- Backend relayer service (stays as VITE_ env var for now)
- Rate limiting

---

### T3: Session Persistence

**Context:** Currently `localStorage` saves one Safe. Need robust session handling so users don't lose their wallet on page reload or revisit.

**Files to modify:**
- `src/lib/storage.ts` — Support multiple saved Safes per device, add `getActiveSafe()` / `setActiveSafe()`, store credential metadata
- `src/App.tsx` — On load, check for existing Safes and skip creation flow if found
- `src/components/WalletDashboard.tsx` — Add Safe selector if multiple Safes exist

**Files to create:**
- `src/components/SafeSelector.tsx` — Dropdown/list to switch between Safes (if user has multiple)

**Acceptance Criteria:**
- [ ] User reopens browser → lands directly on dashboard (not creation flow)
- [ ] Multiple Safes can be saved and switched between
- [ ] Active Safe persists across sessions
- [ ] "Disconnect" still works to clear current Safe
- [ ] Credential IDs properly stored for passkey re-authentication

**Out of scope:**
- Cloud sync / cross-device recovery
- Supabase integration

---

### T4: Transaction History

**Context:** No transaction history exists. Need a full history view with filtering.

**Files to create:**
- `src/lib/history.ts` — Fetch tx history from Safe Transaction Service API (or parse on-chain events), normalize into a common format
- `src/components/TransactionHistory.tsx` — History list view with filters
- `src/components/TransactionItem.tsx` — Single transaction row (date, type, amount, token, status)

**Files to modify:**
- `src/components/WalletDashboard.tsx` — Add "History" tab/view, navigation to history
- `src/lib/router.ts` — Add `history` route if needed
- `src/styles.css` — History list styles, filters, status badges

**Acceptance Criteria:**
- [ ] Shows all Safe transactions (sends, receives, owner changes)
- [ ] Each tx shows: date, type (send/receive/owner change), amount, token, chain, status
- [ ] Filterable by token
- [ ] Handles loading, empty state, and errors gracefully
- [ ] Tapping a tx shows detail or links to block explorer

**Dependencies:** T1 (needs token info for display)

**Out of scope:**
- Pagination / infinite scroll (show last 50)
- Real-time updates via websocket

---

### T5: Re-send from History

**Context:** Quick action to repeat a previous transaction.

**Files to modify:**
- `src/components/TransactionItem.tsx` — Add "Send again" action button
- `src/components/WalletDashboard.tsx` — Handle pre-filled send flow from history item

**Acceptance Criteria:**
- [ ] "Send again" button visible on send-type transactions in history
- [ ] Tapping pre-fills: recipient, amount, token (all editable)
- [ ] 2-3 taps from history to confirmation
- [ ] Works for ETH and ERC-20 sends

**Dependencies:** T4

**Out of scope:**
- Re-sending owner management txs
- Templates / favorites

---

### T6: Uniswap Swaps + Protocol Fee

**Context:** Integrate token swaps via Uniswap with a protocol fee for CoBuilders.

**Files to create:**
- `src/lib/swap.ts` — Uniswap quote fetching (Quoter contract or SDK), swap encoding via Universal Router, fee calculation and splitting
- `src/components/SwapView.tsx` — Swap UI (from token, to token, amount, quote, slippage)

**Files to modify:**
- `src/components/WalletDashboard.tsx` — Add "Swap" nav action
- `src/lib/safe.ts` — May need batch tx encoding (MultiSend) for approve + swap + fee transfer
- `src/lib/router.ts` — Add swap route if separate view
- `src/styles.css` — Swap UI styles

**Acceptance Criteria:**
- [ ] User can select input token, output token, and amount
- [ ] Quote displayed before confirmation (with price impact)
- [ ] 0.5% fee deducted from input amount and sent to treasury (relayer address)
- [ ] Swap executes as a batched Safe tx (approve + swap + fee)
- [ ] Slippage protection (default 0.5%, configurable)
- [ ] Loading states and error handling for failed quotes/txs

**Dependencies:** T1 (token list and selection)

**Out of scope:**
- Limit orders
- Multi-hop route optimization
- Fee dashboard / analytics

---

### T7: Chain Abstraction (Across Protocol)

**Context:** Enable cross-chain sends using Across Protocol for bridging. User selects origin and destination chain — app handles bridging transparently.

**Files to create:**
- `src/lib/bridge.ts` — Across SDK integration, quote fetching, bridge tx encoding
- `src/lib/chains.ts` — Chain definitions (Base, Ethereum, Arbitrum), RPC URLs, chain metadata
- `src/components/ChainSelector.tsx` — Chain picker UI for send flow

**Files to modify:**
- `src/components/WalletDashboard.tsx` — Integrate chain selection in send flow
- `src/lib/relayer.ts` — Support multiple chain clients (not just Base Sepolia)
- `src/styles.css` — Chain selector styles, chain icons

**Acceptance Criteria:**
- [ ] User can select destination chain when sending
- [ ] Across quote displayed (estimated time, fees)
- [ ] Bridge tx executes from Safe
- [ ] Status tracking for in-flight bridges
- [ ] Supported chains: Base, Ethereum, Arbitrum (testnet equivalents)

**Dependencies:** T1 (multi-token), T3 (session persistence for multi-chain state)

**Out of scope:**
- Multi-chain Safe deployment
- Unified balance aggregation across chains
- "Preferred chain" auto-consolidation

---

### T8: Settings / Signer Management

**Context:** Create a settings screen showing Safe configuration and enabling signer changes.

**Files to create:**
- `src/components/Settings.tsx` — Settings screen (owners list, threshold, signer type)
- `src/components/SignerSwitch.tsx` — Flow to switch from Passkey to Ledger (or vice versa)

**Files to modify:**
- `src/components/WalletDashboard.tsx` — Add settings gear icon / nav
- `src/lib/safe.ts` — Add `encodeSwapOwner()` function, `encodeChangeThreshold()`
- `src/lib/router.ts` — Add `settings` route
- `src/styles.css` — Settings page styles

**Acceptance Criteria:**
- [ ] Settings screen shows: current owners (addresses), threshold, signer type
- [ ] Can view owner details (address, label, type: passkey/ledger)
- [ ] "Switch to Ledger" flow: adds Ledger as owner, removes passkey owner (batched Safe tx)
- [ ] Threshold change UI (if multiple owners)
- [ ] Safety check: cannot remove last owner without adding replacement first

**Out of scope:**
- Ledger integration (just the Safe tx encoding — actual Ledger signing is future)
- Module management

---

### T9: Improved Add Signer Flow

**Context:** Current "Add Owner" flow works but UX is basic. Need a polished step-by-step wizard with invite links.

**Files to create:**
- `src/components/InviteSigner.tsx` — Invite flow: generate link/QR, share, track status

**Files to modify:**
- `src/components/JoinWallet.tsx` — Improve the joining experience (clearer steps, better error states)
- `src/components/WalletDashboard.tsx` — Replace current add-owner with new invite flow
- `src/styles.css` — Wizard/stepper styles

**Acceptance Criteria:**
- [ ] Owner can generate an invite link with one tap
- [ ] Invite link shows as QR code + copy button + share (if Web Share API available)
- [ ] New signer opens link → sees clear instructions → creates passkey → signer deployed
- [ ] Original owner sees status update when new signer is ready
- [ ] addOwnerWithThreshold tx triggered automatically after new signer setup
- [ ] Works when invitee doesn't have the app (link goes to app URL)

**Dependencies:** T8 (signer management logic, encodeSwapOwner, etc.)

**Out of scope:**
- Invite expiry
- Revoking pending invites
- Push notifications

---

### T11: Ledger Integration (Real)

**Context:** T8 added the Settings screen with "Switch to Ledger" as coming soon. This task implements the actual Ledger connection.

**Files to create:**
- `src/lib/ledger.ts` — Ledger transport (WebUSB/WebHID), Ethereum app connection, address derivation, transaction signing

**Files to modify:**
- `src/components/SignerSwitch.tsx` — Replace "coming soon" with real Ledger connection flow: detect device → get address → swapOwner tx → confirm
- `package.json` — Add `@ledgerhq/hw-transport-webusb` and `@ledgerhq/hw-app-eth`

**Acceptance Criteria:**
- [ ] User can connect Ledger via USB from mobile/desktop browser
- [ ] App reads Ethereum address from Ledger
- [ ] swapOwner Safe tx replaces passkey signer with Ledger address
- [ ] After switch, transactions require Ledger signature instead of passkey
- [ ] Error handling: device not found, app not open, user rejected
- [ ] Fallback to WebHID if WebUSB not available

**Dependencies:** T8

**Out of scope:**
- Bluetooth Ledger (Nano X) — USB only for now
- Multi-path derivation selection

---

### T11b: Ledger Transaction Signing + Address Selector

**Context:** After swapOwner, the Safe's signer is a Ledger address. But the send flow still calls `signWithPasskey()` which fails. The entire transaction signing flow must detect the signer type and route accordingly. Also, users with multiple Ethereum addresses on their Ledger need to choose which one to use.

**Files to modify:**
- `src/lib/ledger.ts` — Add `getMultipleAddresses(count: number)` that derives addresses from paths m/44'/60'/0'/0/0 through m/44'/60'/0'/0/N. Add `signSafeTransaction()` that signs a Safe tx hash with the Ledger.
- `src/lib/storage.ts` — Add `signerType` field to `SavedOwner`: `'passkey' | 'ledger'`. Store the derivation path used.
- `src/components/WalletDashboard.tsx` — In send flow, detect signer type. If Ledger: prompt user to connect device and sign on it (instead of Passkey biometric).
- `src/components/SignerSwitch.tsx` — Replace hardcoded single address with address selector (show first 5 addresses with ETH balances, user picks one).
- `src/components/ApproveTransaction.tsx` — Support Ledger signing for multi-sig approval flow.

**Acceptance Criteria:**
- [ ] After switching to Ledger, user can send ETH/tokens by signing on the Ledger device
- [ ] Address selector shows first 5 derived addresses with balances
- [ ] User can select which Ledger address to use as signer
- [ ] Signer type persisted in localStorage — app remembers it's a Ledger signer
- [ ] Clear UX: "Connect your Ledger and confirm on device" prompts
- [ ] Multi-sig approval also works with Ledger signing
- [ ] No feature is half-implemented — if you can switch to Ledger, you can USE Ledger

**Dependencies:** T11

---

### T12: Playwright E2E Test Suite

**Context:** Final validation phase. Automated tests for all critical user flows.

**Files to create:**
- `playwright.config.ts` — Playwright config (mobile viewport, baseURL)
- `e2e/wallet-create.spec.ts` — Test wallet creation flow
- `e2e/send-tokens.spec.ts` — Test sending ETH and ERC-20s
- `e2e/history.spec.ts` — Test transaction history renders
- `e2e/settings.spec.ts` — Test settings, owner display, threshold
- `e2e/signer-flow.spec.ts` — Test add signer invite flow

**Acceptance Criteria:**
- [ ] All critical flows have at least one happy-path test
- [ ] Tests run in CI (GitHub Actions)
- [ ] Mobile viewport (375px) used for all tests
- [ ] Console error detection — tests fail if console.error fires
- [ ] Screenshot comparison for visual regression

**Dependencies:** All feature tasks complete

---

### T13: UI Polish Pass

**Context:** Automated + manual review of every screen for consistency, edge cases, and polish.

**Acceptance Criteria:**
- [ ] Every screen has proper loading, empty, and error states
- [ ] Design system is consistent (colors, spacing, typography, border-radius)
- [ ] All interactive elements have hover/active/disabled states
- [ ] No orphaned UI text (everything meaningful)
- [ ] Responsive from 320px to 428px (iPhone SE to iPhone Pro Max)

---

### T14: Human QA + Sign-off

**Context:** Manual testing by Augusto and team on real devices before declaring Done.

**Acceptance Criteria:**
- [ ] Tested on iPhone Safari
- [ ] Tested on Android Chrome
- [ ] Tested with real Ledger device
- [ ] Bug list created, fixed, and re-tested
- [ ] Final sign-off from Augusto

---

### T10: ENS Subdomains (DEFERRED)

Deferred. Requires ENS parent domain registration and CCIP-Read resolver setup.

---

## Execution Notes

- Each task = 1 git worktree + 1 Claude Code instance (Minion)
- Branch naming: `feature/<task-id>-<short-name>` (e.g., `feature/t1-multi-token`)
- On completion: push branch → Vercel preview auto-generated → notify for review
- On approval: merge to main
- If tasks modify the same file (e.g., `WalletDashboard.tsx`), Wave 1 tasks establish the base, Wave 2+ tasks rebase on top
