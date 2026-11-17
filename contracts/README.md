# SealPay contracts

Foundry project for the SealPay invoice protocol on QDay Aevum (chain 44005).

See the root [`README.md`](../README.md) for the full project, deployed addresses, and demo script.

```bash
forge build
forge test
```

Deploy:

```bash
cp .env.example .env
forge script script/Deploy.s.sol:Deploy --rpc-url https://rpc-test.qday.info --broadcast
```

Deploy an agent policy against the existing stack:

```bash
SEALPAY_ADDRESS=0x... PAYER_ADDRESS=0x... AGENT_ADDRESS=0x... \
forge script script/DeployPolicy.s.sol:DeployPolicy \
  --rpc-url https://rpc-test.qday.info --broadcast
```

Gate 1 (ML-DSA feasibility probe):

```bash
forge script script/Gate1.s.sol:Gate1 --rpc-url https://rpc-test.qday.info --broadcast
cast send <PROBE> "probe()" --rpc-url https://rpc-test.qday.info --private-key $PRIVATE_KEY
cast call <PROBE> "lastGasUsed()(uint256)" --rpc-url https://rpc-test.qday.info
```

End-to-end smoke test (from `scripts/`, needs a funded payer and a fresh vendor key):

```bash
SEALPAY_ADDRESS=0x... REGISTRY_ADDRESS=0x... \
PAYER_PRIVATE_KEY=0x... VENDOR_PRIVATE_KEY=0x... \
node e2e-aevum.mjs
```

See [`scripts/README.md`](../scripts/README.md) for policy-mode e2e usage.

Aevum does not support Cancun `MCOPY`; the project targets Shanghai and patches the vendored ML-DSA
library and OpenZeppelin `Bytes.sol`.
