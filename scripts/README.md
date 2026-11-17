# Scripts

## `e2e-aevum.mjs`

End-to-end smoke test against QDay Aevum. It generates a fresh ML-DSA-44 key, registers the vendor if
needed, signs an EIP-712 invoice, approves tUSD8, pays, and reads back the invoice status and balances.

**Prerequisites**

- Payer and vendor EOAs hold tQDAY for gas.
- Payer holds at least `AMOUNT` tUSD8.
- For policy mode: a deployed `PaymentPolicy` where the payer is `PAYER_PRIVATE_KEY`'s address, and the
  payer has not revoked it. The script enables the policy as a `SealPay` operator and allowlists the vendor
  and payee if needed.

**Required environment**

| Variable | Meaning |
|---|---|
| `SEALPAY_ADDRESS` | Deployed `SealPay` |
| `REGISTRY_ADDRESS` | Deployed `VendorRegistry` |
| `PAYER_PRIVATE_KEY` | Payer EOA key (testnet only) |
| `VENDOR_PRIVATE_KEY` | Fresh vendor EOA key (testnet only) |
| `TUSD8_ADDRESS` | Defaults to the Aevum tUSD8 address |
| `AMOUNT` | Base units, default `1000000` (1 tUSD8) |

Optional: `AEVUM_RPC`, `PAYEE_ADDRESS` (defaults to vendor), `VENDOR_MLDSA_SEED` (32-byte hex, required only
when reusing an already-registered vendor), `POLICY_ADDRESS`, `AGENT_PRIVATE_KEY` (defaults to payer).

**Direct payment**

```bash
cd scripts
npm install
SEALPAY_ADDRESS=0x... \
REGISTRY_ADDRESS=0x... \
PAYER_PRIVATE_KEY=0x... \
VENDOR_PRIVATE_KEY=0x... \
AMOUNT=100000 \
node e2e-aevum.mjs
```

**Policy-scoped agent payment**

```bash
SEALPAY_ADDRESS=0x... \
REGISTRY_ADDRESS=0x... \
PAYER_PRIVATE_KEY=0x... \
VENDOR_PRIVATE_KEY=0x... \
POLICY_ADDRESS=0x... \
AGENT_PRIVATE_KEY=0x... \
AMOUNT=100000 \
node e2e-aevum.mjs
```

A successful run ends with `invoice status 2 (2 = Paid)` and the expected tUSD8 balances.

## `gen-mldsa-fixture.mjs`

Regenerates the committed ML-DSA-44 test vector used by `contracts/test/MLDSA44Verifier.t.sol`:

```bash
node gen-mldsa-fixture.mjs > ../contracts/test/generated/MLDSA44Vector.sol
```
