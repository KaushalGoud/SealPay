# Demo script (3–5 minutes)

A tight walkthrough for judges. It shows the happy path, a tamper attempt, a replay attempt, and a
prompt-injected agent.

## Before you start

- Live addresses are in the root [`README.md`](../README.md#live-on-aevum-testnet); `app/.env.local` already
  points at them.
- The deployed demo policy uses the deployer address as both payer and agent, with a 1 tUSD8 per-tx cap and
  a 5 tUSD8 daily cap. For a separated agent, deploy another policy with `script/DeployPolicy.s.sol`.
- Vendor wallet and payer wallet both funded with tQDAY (`https://faucet.qday.info`).
- Payer holds a little tUSD8 (ask in the QDay Discord if the faucet does not dispense it).

## 1. Vendor signs an invoice (60s)

Open `/vendor`. Connect the vendor wallet.

1. **Generate ML-DSA-44 key** — show the key hash and the registered public key.
2. **Register key** — one transaction. Point out that the key lives in the registry, bound to this address.
3. Fill in `amount = 4200` (tUSD8 has 6 decimals, so this is 4,200.000000), payee = vendor, expiry = 30
   days, payer = `0x0` for an open invoice.
4. **Sign invoice** — the bundle appears with a 4,844-hex-character signature.

Say: *the invoice is now an object, not text. The signature covers every field.*

## 2. Payer verifies and pays (90s)

Open `/pay` in a second browser profile. Connect the payer wallet and paste the bundle.

1. Point at the green **valid ML-DSA signature** badge and the digest.
2. Click **Tamper with amount (×10)**. The digest changes, the badge turns red, and the page explains that
   the payment would revert.
3. Restore. Approve tUSD8, then **Pay invoice**.
4. Show the explorer link and the `InvoicePaid` event.
5. Click **Pay** again (or reload and pay): `AlreadyPaid`.

Say: *tampering and replay are not UI warnings. They are contract reverts.*

## 3. Agent with a scoped policy (60s)

Open `/agent`.

1. Show the policy card: agent, payer, per-transaction cap, daily cap, remaining today, expiry.
2. Load a vendor-signed invoice whose payer is the policy payer.
3. Show the policy checks: signature valid, vendor allowed, payee allowed, within cap, not expired.
4. Click **Simulate prompt injection** — the payee becomes `0x…dEaD`, the signature stops matching, and the
   panel says the payment would revert.
5. Restore and click **Execute agent payment**. Show the success and the policy event.
6. If time: try an invoice over the per-transaction cap. Show `OverCap`.

Say: *the agent can act autonomously, but only inside the limits the payer signed up for. The invoice still
has to be vendor-signed.*

## 4. Close (30s)

- One sentence: *prompt injection changes what an agent says, not what the chain accepts.*
- One sentence on QDay: *invoice authenticity is post-quantum today; the account layer catches up on
  QDay's roadmap.*
- One sentence on honesty: *payer transactions are still ECDSA, the verifier is unaudited, keys are in
  localStorage for the demo.*

## Failure cases to have ready

| Case | Expected |
|---|---|
| Tampered amount | `InvalidSignature` |
| Second payment | `AlreadyPaid` |
| Expired invoice | `Expired` |
| Unregistered vendor | `VendorNotRegistered` |
| Wrong payer under policy | `WrongPayer` |
| Unknown payee under policy | `PayeeNotAllowed` |
| Over cap | `OverCap` |
| Revoked policy | `PolicyRevokedError` |
