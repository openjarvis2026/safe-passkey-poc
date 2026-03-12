# Safe + Passkeys PoC

A proof of concept demonstrating **Safe multisig wallets with WebAuthn Passkeys as signers** on Base Sepolia.

## How it works

1. **Create Passkey** — generates a P-256 keypair via WebAuthn (Touch ID / Face ID)
2. **Deploy Signer Proxy** — deploys a `SafeWebAuthnSigner` contract via the factory
3. **Deploy Safe** — creates a Safe proxy with the passkey signer as sole owner
4. **Fund Safe** — send Base Sepolia ETH to the Safe address
5. **Sign Transaction** — signs a Safe transaction hash using the passkey
6. **Execute Transaction** — submits the signed transaction on-chain via the relayer

The passkey signs the Safe transaction hash. A relayer EOA submits the transaction on-chain. The Safe verifies the WebAuthn signature via the signer contract (using EIP-7212 P-256 precompile on Base).

## Setup

```bash
# Install dependencies
npm install

# Copy env and set your relayer private key
cp .env.example .env

# Generate a new relayer key (if needed)
# cast wallet new

# Fund the relayer with Base Sepolia ETH
# Faucet: https://www.alchemy.com/faucets/base-sepolia

# Start dev server
npm run dev
```

## ⚠️ Security Note

The `VITE_` prefix exposes the relayer private key in the browser bundle. This is **acceptable for a PoC only** — never do this in production.

## Stack

- Vite + React + TypeScript
- [viem](https://viem.sh) for contract interaction
- WebAuthn API (native browser)
- [cbor-x](https://github.com/nicolo-ribaudo/cbor-x) for CBOR parsing
- Base Sepolia (Chain ID: 84532)

## Key Contracts

| Contract | Address |
|----------|---------|
| SafeWebAuthnSignerFactory | `0x1d31F259eE307358a26dFb23EB365939E8641195` |
| DaimoP256Verifier | `0xc2b78104907F722DABAc4C69f826a522B2754De4` |
| Safe Singleton (v1.4.1) | `0x41675C099F32341bf84BFc5382aF534df5C7461a` |
| Safe Proxy Factory | `0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67` |
