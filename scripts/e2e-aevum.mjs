import { randomBytes } from "node:crypto";
import {
  createPublicClient,
  createWalletClient,
  hashTypedData,
  http,
  keccak256,
  parseAbi,
  stringToHex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { ml_dsa44 } from "@noble/post-quantum/ml-dsa.js";

const RPC = process.env.AEVUM_RPC ?? "https://rpc-test.qday.info";
const SEALPAY = required("SEALPAY_ADDRESS");
const REGISTRY = required("REGISTRY_ADDRESS");
const TUSD8 = process.env.TUSD8_ADDRESS ?? "0x456569838f1d43009A91ebA4263147Afd7233483";
const PAYER_KEY = required("PAYER_PRIVATE_KEY");
const VENDOR_KEY = required("VENDOR_PRIVATE_KEY");
const AMOUNT = BigInt(process.env.AMOUNT ?? "1000000");
const POLICY = process.env.POLICY_ADDRESS;
const AGENT_KEY = process.env.AGENT_PRIVATE_KEY ?? PAYER_KEY;

const chain = {
  id: 44005,
  name: "QDay Aevum",
  nativeCurrency: { name: "tQDAY", symbol: "tQDAY", decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
};

const sealPayAbi = parseAbi([
  "function payInvoice((bytes32 invoiceId, address vendor, address payer, address token, uint256 amount, address payee, uint64 dueDate, uint64 expiry, uint256 nonce) invoice, bytes vendorSignature)",
  "function getInvoice(bytes32 invoiceId) view returns ((bytes32 invoiceHash, address vendor, address payer, address token, uint256 amount, address payee, uint64 dueDate, uint64 expiry, uint8 status))",
  "function isOperator(address payer, address operator) view returns (bool)",
  "function setOperator(address operator, bool allowed)",
]);
const policyAbi = parseAbi([
  "function pay((bytes32 invoiceId, address vendor, address payer, address token, uint256 amount, address payee, uint64 dueDate, uint64 expiry, uint256 nonce) invoice, bytes vendorSignature)",
  "function payer() view returns (address)",
  "function agent() view returns (address)",
  "function active() view returns (bool)",
  "function perTxCap() view returns (uint128)",
  "function dailyCap() view returns (uint128)",
  "function allowedVendor(address) view returns (bool)",
  "function allowedPayee(address) view returns (bool)",
  "function setVendorAllowed(address vendor, bool allowed)",
  "function setPayeeAllowed(address payee, bool allowed)",
]);
const registryAbi = parseAbi([
  "function register(bytes publicKey)",
  "function isRegistered(address vendor) view returns (bool)",
]);
const erc20Abi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
]);

const invoiceTypes = {
  Invoice: [
    { name: "invoiceId", type: "bytes32" },
    { name: "vendor", type: "address" },
    { name: "payer", type: "address" },
    { name: "token", type: "address" },
    { name: "amount", type: "uint256" },
    { name: "payee", type: "address" },
    { name: "dueDate", type: "uint64" },
    { name: "expiry", type: "uint64" },
    { name: "nonce", type: "uint256" },
  ],
};

const transport = http(RPC);
const publicClient = createPublicClient({ chain, transport });
const payer = privateKeyToAccount(PAYER_KEY);
const vendor = privateKeyToAccount(VENDOR_KEY);
const agent = privateKeyToAccount(AGENT_KEY);
const payerWallet = createWalletClient({ account: payer, chain, transport });
const vendorWallet = createWalletClient({ account: vendor, chain, transport });
const agentWallet = createWalletClient({ account: agent, chain, transport });

const now = Math.floor(Date.now() / 1000);
const invoiceId = keccak256(stringToHex(`sealpay-e2e-${vendor.address}-${now}`));
const invoice = {
  invoiceId,
  vendor: vendor.address,
  payer: payer.address,
  token: TUSD8,
  amount: AMOUNT,
  payee: process.env.PAYEE_ADDRESS ?? vendor.address,
  dueDate: BigInt(now + 7 * 24 * 60 * 60),
  expiry: BigInt(now + 30 * 24 * 60 * 60),
  nonce: BigInt(now),
};

const domain = { name: "SealPay", version: "1", chainId: chain.id, verifyingContract: SEALPAY };
const digest = hashTypedData({ domain, types: invoiceTypes, primaryType: "Invoice", message: invoice });

const seed = process.env.VENDOR_MLDSA_SEED
  ? Buffer.from(process.env.VENDOR_MLDSA_SEED.replace(/^0x/, ""), "hex")
  : randomBytes(32);
if (seed.length !== 32) throw new Error("VENDOR_MLDSA_SEED must be 32 bytes");
const { publicKey, secretKey } = ml_dsa44.keygen(seed);
const signature = ml_dsa44.sign(Buffer.from(digest.slice(2), "hex"), secretKey);
if (!ml_dsa44.verify(signature, Buffer.from(digest.slice(2), "hex"), publicKey)) {
  throw new Error("local ML-DSA verification failed");
}
const signatureHex = "0x" + Buffer.from(signature).toString("hex");

console.log("payer        ", payer.address);
console.log("vendor       ", vendor.address);
console.log("payee        ", invoice.payee);
console.log("invoiceId    ", invoiceId);
console.log("digest       ", digest);
console.log("publicKey    ", publicKey.length, "bytes");
console.log("signature    ", signature.length, "bytes");

const registered = await publicClient.readContract({
  address: REGISTRY,
  abi: registryAbi,
  functionName: "isRegistered",
  args: [vendor.address],
});

if (registered && !process.env.VENDOR_MLDSA_SEED) {
  throw new Error(
    "vendor is already registered with a different ML-DSA key; use a fresh VENDOR_PRIVATE_KEY or set VENDOR_MLDSA_SEED to the original seed",
  );
}

if (!registered) {
  console.log("registering vendor ML-DSA key...");
  const hash = await vendorWallet.writeContract({
    address: REGISTRY,
    abi: registryAbi,
    functionName: "register",
    args: ["0x" + Buffer.from(publicKey).toString("hex")],
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  console.log("register tx  ", hash, "status", receipt.status);
}

if (POLICY) {
  const policyPayer = await publicClient.readContract({
    address: POLICY,
    abi: policyAbi,
    functionName: "payer",
  });
  const policyAgent = await publicClient.readContract({
    address: POLICY,
    abi: policyAbi,
    functionName: "agent",
  });
  if (String(policyPayer).toLowerCase() !== payer.address.toLowerCase()) {
    throw new Error("policy payer does not match PAYER_PRIVATE_KEY");
  }
  if (String(policyAgent).toLowerCase() !== agent.address.toLowerCase()) {
    throw new Error("policy agent does not match AGENT_PRIVATE_KEY");
  }

  console.log("policy       ", POLICY);
  console.log("policy payer ", policyPayer);
  console.log("policy agent ", policyAgent);
  console.log("per-tx cap   ", String(await publicClient.readContract({ address: POLICY, abi: policyAbi, functionName: "perTxCap" })));
  console.log("daily cap    ", String(await publicClient.readContract({ address: POLICY, abi: policyAbi, functionName: "dailyCap" })));

  const operator = await publicClient.readContract({
    address: SEALPAY,
    abi: sealPayAbi,
    functionName: "isOperator",
    args: [payer.address, POLICY],
  });
  if (!operator) {
    console.log("enabling policy operator...");
    const hash = await payerWallet.writeContract({
      address: SEALPAY,
      abi: sealPayAbi,
      functionName: "setOperator",
      args: [POLICY, true],
    });
    await publicClient.waitForTransactionReceipt({ hash });
    console.log("operator tx  ", hash);
  }

  const vendorAllowed = await publicClient.readContract({
    address: POLICY,
    abi: policyAbi,
    functionName: "allowedVendor",
    args: [vendor.address],
  });
  if (!vendorAllowed) {
    console.log("allowlisting vendor...");
    const hash = await payerWallet.writeContract({
      address: POLICY,
      abi: policyAbi,
      functionName: "setVendorAllowed",
      args: [vendor.address, true],
    });
    await publicClient.waitForTransactionReceipt({ hash });
    console.log("vendor tx    ", hash);
  }

  const payeeAllowed = await publicClient.readContract({
    address: POLICY,
    abi: policyAbi,
    functionName: "allowedPayee",
    args: [invoice.payee],
  });
  if (!payeeAllowed) {
    console.log("allowlisting payee...");
    const hash = await payerWallet.writeContract({
      address: POLICY,
      abi: policyAbi,
      functionName: "setPayeeAllowed",
      args: [invoice.payee, true],
    });
    await publicClient.waitForTransactionReceipt({ hash });
    console.log("payee tx     ", hash);
  }
}

const allowance = await publicClient.readContract({
  address: TUSD8,
  abi: erc20Abi,
  functionName: "allowance",
  args: [payer.address, SEALPAY],
});
if (allowance < AMOUNT) {
  console.log("approving tUSD8...");
  const hash = await payerWallet.writeContract({
    address: TUSD8,
    abi: erc20Abi,
    functionName: "approve",
    args: [SEALPAY, AMOUNT],
  });
  await publicClient.waitForTransactionReceipt({ hash });
  console.log("approve tx   ", hash);
}

console.log(POLICY ? "agent paying via policy..." : "paying invoice...");
const payHash = POLICY
  ? await agentWallet.writeContract({
      address: POLICY,
      abi: policyAbi,
      functionName: "pay",
      args: [invoice, signatureHex],
    })
  : await payerWallet.writeContract({
      address: SEALPAY,
      abi: sealPayAbi,
      functionName: "payInvoice",
      args: [invoice, signatureHex],
    });
const receipt = await publicClient.waitForTransactionReceipt({ hash: payHash });
console.log("pay tx       ", payHash, "status", receipt.status, "gasUsed", receipt.gasUsed);

const record = await publicClient.readContract({
  address: SEALPAY,
  abi: sealPayAbi,
  functionName: "getInvoice",
  args: [invoiceId],
});
const status = Number(record.status ?? record[8]);
console.log("invoice status", status, "(2 = Paid)");

const payerBalance = await publicClient.readContract({
  address: TUSD8,
  abi: erc20Abi,
  functionName: "balanceOf",
  args: [payer.address],
});
const payeeBalance = await publicClient.readContract({
  address: TUSD8,
  abi: erc20Abi,
  functionName: "balanceOf",
  args: [invoice.payee],
});
console.log("payer tUSD8  ", payerBalance.toString());
console.log("payee tUSD8  ", payeeBalance.toString());

if (receipt.status !== "success" || status !== 2) {
  process.exitCode = 1;
}

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`missing ${name}`);
  return value;
}
