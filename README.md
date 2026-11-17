# SealPay

**Signed invoices for the agent economy.** A vendor signs the invoice object with ML-DSA (NIST FIPS 204),
the payment contract verifies that signature on-chain, and only then does tUSD8 move. Change the amount,
payee, due date, token, payer, or invoice id and the payment reverts.

Built for **Aevum Builder Challenge #1** on the **QDay Aevum testnet** (chain `44005`).

---

## Why this exists

An invoice is usually just text. Text can be forged, tampered with, or injected with instructions — and once
an AI agent is in the accounts-payable loop, "the model read the invoice" is not a security boundary.

SealPay turns the invoice into a signed object:

- The vendor signs an **EIP-712 struct** with **ML-DSA-44**.
- The digest binds chain id, contract address, invoice id, vendor, payer, token, amount, payee, due date,
  expiry, and nonce.
- `SealPay.payInvoice` reconstructs the digest and verifies the post-quantum signature **inside the contract**
  before calling `transferFrom`.
- The invoice id is consumed exactly once, so the same signed invoice cannot be replayed.

A prompt-injected agent can change what it *says*. It cannot change what the vendor *signed*.

### Why post-quantum, why QDay

QDay is a post-quantum, EVM-compatible network that settles to Abelian, and its roadmap moves to native
ML-DSA accounts. Today, Aevum accounts are still ECDSA. SealPay demonstrates the application-layer version
of that direction: invoice authenticity that survives the transition, without waiting for the protocol.

Honest scope: **the invoice attestation is post-quantum**. The payer's EOA transaction and the chain's own
signatures are still ECDSA in this build.

---

## Architecture

```
Vendor browser                         QDay Aevum (44005)
──────────────                         ───────────────────
ML-DSA-44 key ──register(pk)──────────▶ VendorRegistry
      │                                       │ public key
      │ sign EIP-712 digest                   ▼
      └──────────────────────────▶ SealPay ──verify──▶ MLDSA44Verifier
                                     │
Payer ──payInvoice───────────────────┤ safeTransferFrom
                                     ▼
                                   tUSD8 ─────────────▶ payee

Agent ──pay()──▶ PaymentPolicy ──payInvoiceFrom──▶ SealPay
                  caps · allowlists · expiry · revoke
```

### Contracts

| Contract | Responsibility |
|---|---|
| `VendorRegistry` | Vendor address → ML-DSA-44 public key. Keys are stored as contract code, and rotation is signed by the current key. |
| `SealPay` | EIP-712 invoice digest, ML-DSA verification, replay protection, tUSD8 settlement, operator approvals. |
| `PaymentPolicy` | Agent allowlist, per-transaction cap, daily cap, expiry, revocation. Never holds funds. |
| `MLDSA44Verifier` | Adapter over a vendored FIPS 204 pure-Solidity verifier. |
| `MockVerifier` | Test double used by the Foundry suite. |

### Invoice object

```solidity
struct Invoice {
    bytes32 invoiceId;
    address vendor;
    address payer;      // address(0) = open invoice
    address token;
    uint256 amount;     // tUSD8 has 6 decimals
    address payee;
    uint64  dueDate;    // bound metadata, displayed to the payer
    uint64  expiry;     // hard cut-off: payment reverts after this
    uint256 nonce;
}
```

Domain: `EIP712("SealPay", "1")`, which commits to `chainId` and the `SealPay` address. The vendor signs the
32-byte digest with ML-DSA-44. The same signed invoice cannot be replayed on another chain, another contract,
or a second time on this one.

---

## Repository layout

```
sealpay/
├── contracts/            Foundry project
│   ├── src/
│   │   ├── SealPay.sol
│   │   ├── VendorRegistry.sol
│   │   ├── PaymentPolicy.sol
│   │   ├── verifier/     ML-DSA adapter + vendored FIPS 204 library
│   │   └── mocks/
│   ├── test/             23 tests (logic + real ML-DSA vector)
│   └── script/           Deploy.s.sol, DeployPolicy.s.sol, Gate1.s.sol
├── app/                  Next.js 16 · wagmi · viem
│   ├── app/vendor        create + sign invoice
│   ├── app/pay           verify + pay
│   └── app/agent         policy-scoped agent console
├── scripts/              ML-DSA fixture generator + Aevum e2e smoke test
│                         (usage: scripts/README.md)
└── docs/                 architecture, threat model, demo script
```

---

## Live on Aevum Testnet

| Contract | Address |
|---|---|
| `MLDSA44Verifier` | `0x18968b2ba52a2719837e478FcBe574Ac20876629` |
| `VendorRegistry` | `0x343a6cC0Ec5940BdD0cA81314daAfc4ACCfF54eE` |
| `SealPay` | `0x32d40F98d194e2B19C65FB148c4b939e982ed2a2` |
| `PaymentPolicy` | `0x02d7fF8Ce36fA258074B2e09E5c297f215c1b3d3` |
| `Gate1Probe` (separate verifier) | `0xa140d9E1945B4866feEcC123d127b465Dc205418` |

- Gate 1 probe tx: `0xe6c0b1d9c7ae5114107e182f1dca19edf94241f726381e0f779d5c5f1e7b6d87` — result `true`,
  **5,781,509 gas** inside the verifier, **5,847,068 gas** total.
- End-to-end invoice payment tx: `0x0d04ce11164ceefd8c20f489c93d6510fc530b395c3203a0158eec2d8ff385d6` —
  registered vendor key, approved tUSD8, paid a signed invoice; **6,068,487 gas** for `payInvoice`.
- Policy-scoped agent payment tx: `0x9df6213327113af86f380db23747d2538fe2ee0298c5e0ff566bb5e18e3c9a76` —
  agent called `PaymentPolicy.pay` after payer setup; **6,118,900 gas**, invoice paid.
- tUSD8: `0x456569838f1d43009A91ebA4263147Afd7233483`.
- The demo policy uses the deployer address (`0x8A26Abe281497381dff89f7daf5f892259EEd44F`) as **both payer
  and agent**, with a 1 tUSD8 per-tx cap and a 5 tUSD8 daily cap. For a separated agent, deploy another policy
  with `script/DeployPolicy.s.sol` and set `NEXT_PUBLIC_POLICY_ADDRESS`.

**Aevum compatibility note:** the chain does not support the Cancun `MCOPY` opcode. `foundry.toml` targets
`evm_version = "shanghai"`, and the vendored ML-DSA library plus OpenZeppelin's `Bytes.sol` were patched to
replace `MCOPY` with byte-copy loops. The first deployment reverted with `invalid opcode: MCOPY` until
this was fixed.

---

## Quickstart

### 1. Contracts

```bash
cd contracts
forge build
forge test                 # 23 tests
```

Deploy to Aevum:

```bash
cp .env.example .env       # add PRIVATE_KEY (testnet only)
forge script script/Deploy.s.sol:Deploy \
  --rpc-url https://rpc-test.qday.info \
  --private-key $PRIVATE_KEY \
  --broadcast
```

Optional verification on the Blockscout explorer:

```bash
forge verify-contract <ADDRESS> src/SealPay.sol:SealPay \
  --chain 44005 --verifier blockscout \
  --verifier-url https://explorer-test.qday.info/api \
  --via-ir --compiler-version 0.8.37
```

At submission time the explorer accepted submissions but did not mark the contracts verified; deployment
and the on-chain smoke tests are the source of truth.

Copy the logged addresses (verifier, registry, SealPay, optional policy) into `app/.env.local`.

### 2. Gate 1: prove ML-DSA verification fits Aevum

This is the first thing to run after deployment.

```bash
cd contracts
forge script script/Gate1.s.sol:Gate1 \
  --rpc-url https://rpc-test.qday.info \
  --private-key $PRIVATE_KEY --broadcast

cast send <PROBE> "probe()" --rpc-url https://rpc-test.qday.info --private-key $PRIVATE_KEY
cast call <PROBE> "lastGasUsed()(uint256)" --rpc-url https://rpc-test.qday.info
```

If the probe transaction succeeds, SealPay's core mechanism works on Aevum. Measured local gas for a
full-path ML-DSA-44 verification: **~5.75M gas** (registered-key precomputation can bring this to
~2.69M; the Fireblocks verifier reports ~1.23M).

Result on Aevum: `probe()` succeeded, returned `true`, and used **5,781,509 gas** inside the verifier
(**5,847,068 gas** for the whole transaction). Local anvil measured **5,753,091 gas** inside the verifier.
The full `payInvoice` path costs **~6.07M gas** on Aevum; the policy-wrapped path costs **~6.12M gas**.

### 3. App

```bash
cd app
cp .env.example .env.local
# NEXT_PUBLIC_SEALPAY_ADDRESS=...
# NEXT_PUBLIC_REGISTRY_ADDRESS=...
# NEXT_PUBLIC_TUSD8_ADDRESS=0x456569838f1d43009A91ebA4263147Afd7233483
# NEXT_PUBLIC_POLICY_ADDRESS=... (optional)
pnpm install
pnpm dev
```

Open `http://localhost:3000`, connect an injected wallet on **QDay Aevum (44005)**, and claim tQDAY from
`https://faucet.qday.info` if you need gas. Run `pnpm typecheck` for the TypeScript check.

### 4. Agent policy (optional)

Deploy a policy with the deploy script by setting `PAYER_ADDRESS` and `AGENT_ADDRESS`, or deploy
`PaymentPolicy` separately. Then, from the payer wallet:

1. `SealPay.setOperator(policy, true)` — lets the policy pay on the payer's behalf.
2. `PaymentPolicy.setVendorAllowed(vendor, true)`.
3. `PaymentPolicy.setPayeeAllowed(payee, true)`.
4. Approve tUSD8 to `SealPay` (the policy never holds funds).

All four steps are exposed as buttons on `/agent` when the connected wallet is the payer.

### 5. End-to-end smoke test (optional)

`scripts/e2e-aevum.mjs` performs the whole flow from the command line: register, sign, approve, pay, and
read back the invoice. It supports both direct and policy-scoped payments. See
[`scripts/README.md`](scripts/README.md) for the environment variables and examples.

---

## Demo walkthrough

1. **Vendor** generates an ML-DSA-44 key, registers it, fills in invoice terms, and signs. The bundle
   contains the invoice, the 2,420-byte signature, and the digest.
2. **Payer** loads the bundle. The UI verifies locally (green) and shows every bound field.
3. Payer clicks **Tamper with amount (×10)**: the digest changes, local verification turns red, and
   `payInvoice` reverts with `InvalidSignature`.
4. Restore the invoice, approve tUSD8, and pay. The explorer shows the on-chain verification.
5. Try to pay again: `AlreadyPaid`.
6. **Agent** loads a signed invoice. Flip **Simulate prompt injection**: the payee changes, the signature
   stops matching, and the policy path refuses. An over-cap invoice reverts with `OverCap`; a revoked
   policy reverts with `PolicyRevokedError`.

---

## Tests

```
contracts/test/SealPay.t.sol            17 tests — tamper, replay, expiry, payer mismatch,
                                                  operator, key rotation, policy caps/revoke
contracts/test/MLDSA44Verifier.t.sol     6 tests — real ML-DSA-44 vector, tampered digest,
                                                  tampered signature, wrong key, gas
```

The real vector is generated by `scripts/gen-mldsa-fixture.mjs` using `@noble/post-quantum` and committed
as `contracts/test/generated/MLDSA44Vector.sol` so tests are reproducible offline.

---

## Security model

| Threat | Control |
|---|---|
| Invoice tampering | Every field is in the EIP-712 digest; verification fails on any change. |
| Replay (same chain) | `invoiceId` consumed once; paid invoices cannot be paid again. |
| Cross-chain / cross-contract replay | Domain separator binds `chainId` and `SealPay` address. |
| Key substitution | Vendor key is bound at registration; rotation requires a signature from the current key. |
| Unauthorised agent spending | `PaymentPolicy`: vendor/payee allowlists, per-tx cap, daily cap, expiry, revocation. |
| Prompt injection | The signed object is authoritative; injection cannot alter a valid signature. |
| Reentrancy | `nonReentrant` + checks-effects-interactions on settlement. |
| Expired invoices | `expiry` is enforced on-chain. |

Details and residual risks: [`docs/threat-model.md`](docs/threat-model.md).

---

## Known limitations

- ML-DSA key in the browser `localStorage` is a **demo** choice. Production needs an HSM, KMS, or passkey
  derived signer.
- Only ML-DSA-44 is wired in. ML-DSA-65/87 are supported by the vendored library but not exposed.
- Full-path verification costs ~5.78M gas on Aevum; a complete `payInvoice` is ~6.07M gas. Precomputed keys
  and the Fireblocks verifier are the next optimization.
- Aevum does not support `MCOPY`. The project targets the Shanghai EVM, and OpenZeppelin's `Bytes.sol` plus
  the vendored ML-DSA library are patched accordingly. Keep that in mind when updating dependencies.
- The vendored verifier is **unaudited**. It passes NIST ACVP vectors and independent differential tests.
- Payer authentication is still ECDSA; only the invoice attestation is post-quantum.
- `dueDate` is bound metadata; `expiry` is the hard payment deadline. There is no late-payment or dispute flow.
- ERC-4337 session keys, ERC-8004 identity, and x402 are not integrated in this build; the policy is
  self-contained so the demo does not depend on unpublished tooling.
- Payments are final. No refunds, escrow, or partial payments.

---

## Roadmap

1. Precomputed ML-DSA keys (2.69M gas) and an adapter for a future ML-DSA precompile (EIP-8051/8355).
2. ERC-4337 session key as the policy executor, with passkey onboarding.
3. ERC-8004 vendor/agent identity for Confirmation of Payee.
4. Invoice financing: a receivable NFT backed by a verified, signed invoice.
5. Vendor multi-signature and delegated signing policies.
6. Indexer for receipts and audit dashboards.

---

## Technologies

Solidity 0.8.37 · Foundry · OpenZeppelin 5.7 · EIP-712 · FIPS 204 ML-DSA-44 · Next.js 16 · React 19 ·
wagmi · viem · `@noble/post-quantum` · QDay Aevum testnet · tUSD8.

## Attribution

The ML-DSA implementation under `contracts/src/verifier/mldsa/` is vendored from
[`skalenetwork/mldsa-solidity`](https://github.com/skalenetwork/mldsa-solidity) (MIT, NIST ACVP-tested,
unaudited). Its license is included alongside the source. The vendored copy has one compatibility change:
its single `MCOPY` instruction was replaced with a byte-copy loop because Aevum does not support Cancun
opcodes. OpenZeppelin 5.7's `utils/Bytes.sol` received the same treatment. OpenZeppelin Contracts 5.7 and
forge-std are vendored under `contracts/lib/` (no submodules) so the repository builds as-is. Everything
else is original code built during the Aevum build window.

## License

MIT.
