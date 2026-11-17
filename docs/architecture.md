# SealPay architecture

SealPay is a small, self-contained protocol for **post-quantum invoice attestation with on-chain
settlement**. It does not hold funds and does not need a backend. Three contracts and one browser do the
work.

```
┌────────────────────┐        ┌──────────────────────┐
│ Vendor browser     │        │ QDay Aevum (44005)   │
│                    │        │                      │
│ ML-DSA-44 keypair  │        │  VendorRegistry      │
│  │ register(pk)    │───────▶│   vendor → pubkey    │
│  │ sign(digest)    │        │                      │
│  ▼                 │        │  MLDSA44Verifier     │
│ signed bundle      │        │   FIPS 204 verify    │
└─────────┬──────────┘        │          ▲           │
          │                   │          │           │
          │ bundle (JSON)     │  SealPay ┘           │
          ▼                   │   EIP-712 · replay   │
┌────────────────────┐        │   tUSD8 settlement   │
│ Payer / Agent      │───────▶│                      │
│ verify + pay       │        │  PaymentPolicy       │
└────────────────────┘        │   caps · allowlists  │
                              └──────────────────────┘

                         tUSD8 ──────────────▶ payee
```

## Components

### VendorRegistry

Maps a vendor payout address to an ML-DSA-44 public key.

- `register(bytes publicKey)` — one-time registration, exactly 1,312 bytes.
- `rotate(bytes newPublicKey, bytes signature)` — signed by the **current** key over
  `keccak256(abi.encode("SealPay.KeyRotation", chainid, registry, vendor, oldKeyHash, newKeyHash, nonce))`.
- `getPublicKey(address)` / `isRegistered(address)` / `rotationNonce(address)`.

Storage trick: the 1,312-byte key is deployed as contract runtime code (SSTORE2 style) through
`MLDSAPublicKeys`. Reading code is cheap (`EXTCODECOPY`) and the key bytes cannot be overwritten. The
registry stores only the code pointer and a hash.

### MLDSA44Verifier

A thin, stateless adapter:

```solidity
function verify(bytes calldata publicKey, bytes32 digest, bytes calldata signature)
    external pure returns (bool)
```

It enforces exact lengths (1,312-byte key, 2,420-byte signature) and delegates to the vendored
`MLDSA.verify(ML_DSA_44, ...)` implementation. The vendored code is from `skalenetwork/mldsa-solidity`
(MIT, NIST ACVP-tested, unaudited). Keeping it behind an interface means the implementation can be
swapped for a precompile or an optimized verifier without touching `SealPay`.

### SealPay

The settlement contract.

- `hashInvoice(Invoice)` — EIP-712 digest.
- `registerInvoice(invoice, signature)` — record an invoice without paying.
- `payInvoice(invoice, signature)` — register-if-needed, verify, settle from `msg.sender`.
- `payInvoiceFrom(payer, invoice, signature)` — same, but for an authorised operator (the policy).
- `setOperator(operator, allowed)` — payer grants a contract permission to spend on its behalf.

The EIP-712 type:

```
Invoice(bytes32 invoiceId,address vendor,address payer,address token,uint256 amount,
        address payee,uint64 dueDate,uint64 expiry,uint256 nonce)
```

Domain: `EIP712("SealPay", "1")`. That commits to `chainId` and the `SealPay` address, so a signature
cannot be replayed on another chain or another deployment. `invoiceId` is consumed once, so it cannot be
replayed on the same deployment.

Settlement ordering (`_settle`):

1. Reject if the record is already `Paid`.
2. If `invoice.payer != 0`, require it to equal the effective payer.
3. If unregistered: validate, verify signature, write `Registered`.
4. If registered: require the recomputed digest to equal the stored hash.
5. Reject if `block.timestamp > expiry`.
6. Set `Paid`, then `safeTransferFrom(payer, payee, amount)` under `nonReentrant`.
7. Emit `InvoicePaid` with both the invoice hash and a signature hash for audit.

Registration and payment are deliberately separate: a vendor can publish an invoice before the payer is
ready, and a payer can settle a known invoice without a prior registration transaction.

### PaymentPolicy

A scoped executor for an AI agent. It never holds tUSD8; the payer approves `SealPay` directly and
registers the policy as an operator.

On `pay(invoice, signature)`:

1. Only the configured agent may call.
2. Policy must be active (not revoked) and not expired.
3. `invoice.payer` must equal the policy payer (no open invoices).
4. Vendor and payee must be allowlisted.
5. Amount must be ≤ per-transaction cap.
6. Rolling 24-hour spend must be ≤ daily cap.
7. Call `SealPay.payInvoiceFrom(payer, ...)`.

Every check reverts the whole transaction, so the spend counter update is rolled back if the invoice
signature fails. The policy never trusts the agent's claim that an invoice is valid; `SealPay` verifies the
vendor signature on every settlement.

## Invoice lifecycle

1. **Register key.** Vendor generates ML-DSA-44 in the browser and sends the public key to
   `VendorRegistry`.
2. **Create.** Vendor fills in invoice terms. `payer = address(0)` means an open invoice.
3. **Sign.** Browser computes the EIP-712 digest via `viem` and signs it with ML-DSA-44.
4. **Share.** The bundle `{invoice, signature, digest}` is copied to the payer or agent (URL, file, chat).
5. **Verify (optional).** Payer verifies locally before sending a transaction; the UI also shows every bound
   field.
6. **Settle.** Payer calls `payInvoice`, or agent calls `PaymentPolicy.pay`. `SealPay` recomputes the
   digest, verifies, marks the invoice paid, and transfers tUSD8.
7. **Audit.** `InvoicePaid` contains the invoice hash and signature hash; the invoice record remains
   queryable via `getInvoice`.

## Trust boundaries

- The browser is untrusted for settlement: it can lie to its user, but it cannot forge a signature or
  bypass contract checks.
- `VendorRegistry` is the only source of vendor keys. A compromised vendor key is a compromised vendor.
- `PaymentPolicy` is trusted only for *spending limits*, not for invoice validity. `SealPay` always
  verifies.
- The chain is trusted for time and settlement finality.

## Gas and scaling

Measured on Aevum testnet (solc 0.8.37, via-IR, optimizer 200, `evm_version = "shanghai"`):

| Operation | Gas |
|---|---|
| Full-path ML-DSA-44 verify (Gate 1 probe) | 5,781,509 |
| `payInvoice` end-to-end (registration + verify + transfer) | 6,068,487 |
| Upstream precomputed-key path (reported) | ~2,690,000 |
| Fireblocks verifier (reported) | ~1,230,000 |
| Registry key registration | ~700,000 (code deposit + storage) |

Aevum rejects the Cancun `MCOPY` opcode (`invalid opcode: MCOPY`). Compiling for Shanghai and replacing
`MCOPY` in the vendored ML-DSA library and OpenZeppelin `Bytes.sol` was required before the probe would
execute. That is why `foundry.toml` pins `evm_version`.

The verifier dominates cost. That is acceptable for invoice settlement, which is high-value and
low-frequency, and it is why Gate 1 checks that a real verification transaction succeeds on Aevum. The
verifier is behind an interface so a precompile (EIP-8051/8355 direction) or precomputed-key variant can be
dropped in later.

## Deployment topology

```
MLDSA44Verifier  ──▶ VendorRegistry ──▶ SealPay ──▶ PaymentPolicy (optional)
```

`Deploy.s.sol` deploys in that order; `Gate1.s.sol` deploys only the verifier plus a probe contract.
`SealPay` is immutable with respect to registry and verifier, so replacing the verifier means deploying a
new `SealPay`.
