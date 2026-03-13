# Wave 1 QA Fixes — Consolidated

## Fix A: Dashboard Data Issues
- [ ] ETH balance mismatch: Total shows 0.005 but token row shows 0 — sync token balances with total
- [ ] Remove "Base Sepolia" from UI completely (still showing in balance card)
- [ ] "Last updated: 11:58:06 PM" → relative time ("Just now", "2 min ago"), no seconds
- [ ] Remove or explain "19" notification badge on identicon
- [ ] Hide zero-balance tokens by default (show "View all tokens" expander)
- [ ] Remove WETH from default visible list
- [ ] "1 of 1" badge → remove or change to "1 device"
- [ ] Rename "Authorized Devices" → "Your Devices"
- [ ] Rename "+ Invite Signer" → "+ Add Device"
- [ ] Bottom hex link → "View on Explorer ↗"

## Fix B: Send Flow
- [ ] Show available balance on send screen
- [ ] Add "Max" button
- [ ] Disable slide-to-send when fields are empty
- [ ] Warn on burn address (0x000...0)
- [ ] Success state: change "Done!" button to "Back to Wallet", show tx summary
- [ ] Disable input fields after send completes

## Fix C: Receive Flow  
- [ ] "Send Base Sepolia ETH to this address" → "Share this address to receive funds"
- [ ] Add "Share" button (Web Share API)
- [ ] Add copy confirmation feedback ("Copied! ✓")
- [ ] Segment hex address for readability (groups of 4)

## Fix D: Swap Flow
- [ ] Exchange rate: "2985.000000" → "2,985.00" (add thousands separator, trim decimals)
- [ ] Trim trailing zeros on amounts ("0.298500" → "0.2985")
- [ ] Fix decimal separator in custom slippage (comma vs period)
- [ ] Add "%" suffix to custom slippage input
- [ ] Disable slide-to-swap when amount is 0
- [ ] Show available balance for source token
- [ ] Add "Max" button

## Fix E: Global Polish
- [ ] Arrow buttons: "↑ Send" → "Send", "↓ Receive" → "Receive", "↔ Swap" → "Swap"
- [ ] Token icons: replace emoji (⚡💙💚💎) with proper SVG token logos
- [ ] Slide-to-confirm: use app primary color (purple) instead of grey when active
- [ ] Consistent card styling across all sections
- [ ] "View All →" in Recent Activity properly styled
