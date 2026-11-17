# SealPay threat model

Scope: the contracts in `contracts/src`, the browser flow in `app/`, and the deploy scripts. This is a
hackathon build, not an audited protocol.

## Assets

1. **Payer funds** — tUSD8 held by the payer and approved to `SealPay`.
2. **Invoice integrity** — the exact terms the vendor agreed to.
3. **Vendor signing key** — the ML-DSA-44 secret key.
4. **Payer authority** — the right to move funds, and the limits on an agent's authority.

## Actors

| Actor | Trust |
|---|---|
| Vendor | Owns its key; trusted for invoices it signs. |
| Payer | Owns funds; trusted to set its own policy and operators. |
| Agent | Untrusted for invoice content; constrained by `PaymentPolicy`. |
| Relayer / bundle carrier | Untrusted; can withhold or reorder, cannot forge. |
| Chain / RPC | Trusted for time, ordering, and finality. |
| Browser | Untrusted for settlement; may be compromised by injection or extensions. |

## Threats and controls

### T1 — Invoice tampering

*Attacker changes the amount or payee after the vendor signed.*

All fields are in the EIP-712 struct and therefore in the digest. `SealPay` recomputes the digest and
verifies with the registered key. Any change flips verification to false, and the call reverts with
`InvalidSignature`.

Residual: none at the contract level. If the UI displays fields from a different object than it signs or
pays, the user could be misled — mitigated by deriving the displayed fields from the same object that is
hashed, and by showing the local verification result.

### T2 — Replay on the same chain

*Attacker re-submits a valid signed invoice.*

`invoices[invoiceId].status` moves `None → Registered → Paid`. A second settlement reverts with
`AlreadyPaid`. Re-registering the same id reverts with `InvoiceExists`.

Residual: an invoice that was registered but never paid can still be paid once. That is intended.

### T3 — Cross-chain or cross-contract replay

*Attacker replays a signature on another deployment.*

The EIP-712 domain separator binds `chainId` and the `SealPay` address. A signature from one deployment
fails on another.

Residual: if two deployments share a chain id and address (e.g. a chain reset), signatures could replay.
Demo-only footgun; document any chain reset.

### T4 — Vendor key substitution

*Attacker registers or rotates a victim vendor's key.*

`register` is keyed by `msg.sender`, so only the vendor address can publish its own key. `rotate` requires a
valid ML-DSA signature from the **current** key over a digest that includes the vendor, old hash, new hash,
and a nonce. `register` cannot be called twice.

Residual: a compromised vendor key can rotate and sign arbitrary invoices. That is inherent; key
management is the vendor's responsibility.

### T5 — Unauthorised agent spending

*Compromised or prompt-injected agent tries to drain the payer.*

The agent cannot move funds directly. It can only call `PaymentPolicy.pay`, which enforces:
active policy, agent identity, payer match, vendor allowlist, payee allowlist, per-transaction cap, rolling
daily cap, and expiry. The payer can revoke at any time; revocation zeroes the agent and cannot be undone.
`SealPay` still verifies the vendor signature.

Residual: allowlist and caps are only as good as the payer's configuration. A malicious vendor that the
payer allowlisted can still issue valid invoices up to the caps. There is no velocity anomaly detection.

### T6 — Prompt injection through invoice text

*Malicious invoice content tells the agent to pay a different address.*

The injection can change what the agent says, but any change to the payee or amount invalidates the
vendor's signature. If the agent passes the modified invoice, `SealPay` reverts. If the agent invents a new
invoice, it has no valid signature and reverts. The policy additionally refuses unknown payees.

Residual: the agent can still be tricked into *choosing* to pay a real, signed, allowlisted invoice at an
inopportune time, within caps.

### T7 — Expired invoice

*Attacker withholds an invoice until after terms change.*

`expiry` is enforced in both `_validate` and `_settle`. `dueDate` is bound metadata only; it does not
block payment. This split is intentional: vendors get a hard validity window and an informational due date.

Residual: no grace period, no late fees, no partial payment. Expired invoices cannot be settled.

### T8 — Reentrancy during settlement

*A malicious token calls back into `SealPay`.*

`payInvoice` and `payInvoiceFrom` are `nonReentrant`; status is set to `Paid` before `safeTransferFrom`.
`SafeERC20` rejects tokens that do not return a boolean or return false.

Residual: fee-on-transfer tokens would break the amount assumption. The demo only supports tUSD8; do not
allowlist arbitrary tokens without accounting for transfers.

### T9 — Malicious or buggy verifier

*The verifier returns true for invalid signatures.*

The vendored ML-DSA code is unaudited. Mitigations: it is NIST ACVP-tested and differentially tested
against `@noble/post-quantum`; the Foundry suite includes a real signature vector, tampered digest,
tampered signature, wrong key, and wrong lengths. The verifier is behind `ISealPayVerifier` so it can be
replaced. `SealPay` cannot be upgraded in place; a verifier change requires a new `SealPay`.

Residual: zero-day in the verifier. Treat this as experimental until audited.

### T10 — Key theft in the browser

*Malware or an XSS reads `localStorage`.*

The demo stores the ML-DSA secret key in `localStorage` for convenience. This is explicitly demo-only.

Production: generate and use keys in an HSM/KMS, hardware wallet, or passkey-backed enclave; never export
the secret to JS. A compromised signing environment can sign arbitrary invoices, and no on-chain control
can prevent that.

### T11 — Spent-counter manipulation

*Agent tries to reset or bypass the daily cap.*

`spentToday` and `dayStart` are private to the policy and updated only in `pay`. The 24-hour window resets
lazily on the first payment after 24 hours. There is no owner function to reset the counter.

Residual: an agent can split payments across the 24-hour boundary to spend up to `dailyCap` at the end of
one window and `dailyCap` again at the start of the next. That is inherent to a rolling window; tighten
caps if it matters.

### T12 — Operator escalation

*Attacker gets `setOperator` called on the payer.*

`setOperator` is permissionless but keyed to `msg.sender`; only the payer can authorise its own operators.
The policy is immutable about its payer. A payer that authorises a malicious operator can be drained within
token approval, which is why the approval to `SealPay` should be limited.

Residual: unlimited tUSD8 approval to `SealPay` plus a malicious operator is dangerous. The UI pays exact
amounts but a compromised front end could request a large approval. Prefer bounded approvals; a future
version should use `permit` and exact allowances.

## Invariants

1. A tUSD8 transfer out of `SealPay` happens only after a `true` return from the verifier for the digest of
   the exact invoice being settled.
2. A given `invoiceId` can be `Paid` at most once.
3. A digest is bound to `chainId` and the `SealPay` address.
4. A vendor key can change only through a signature from the previous key.
5. `PaymentPolicy` never holds funds and can only move funds through `SealPay`.
6. Revoking a policy permanently disables it.

## Out of scope

- Chain-level or wallet ECDSA key compromise (payer transactions are still ECDSA).
- Privacy: invoice amounts are public on-chain.
- Off-chain delivery/authenticity of the bundle; verify the digest out of band.
- Disputes, refunds, escrow, partial payments, invoicing compliance, and tax.
- MEV and transaction ordering.
- ERC-4337, ERC-8004, and x402 integration; not present in this build.
- The security of `@noble/post-quantum` or the vendored Solidity verifier beyond the tested vectors.

## Reporting

This is a testnet hackathon project. Do not use it with real funds. If you find an issue, open an issue in
the repository or contact the author.
