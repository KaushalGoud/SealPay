import { hashTypedData, keccak256, stringToHex, type Address, type Hex } from "viem";

export type Invoice = {
  invoiceId: Hex;
  vendor: Address;
  payer: Address;
  token: Address;
  amount: string;
  payee: Address;
  dueDate: number;
  expiry: number;
  nonce: number;
};

export type SignedInvoice = {
  invoice: Invoice;
  signature: Hex;
  vendorPublicKey?: Hex;
  digest?: Hex;
  createdAt?: number;
};

export type ChainInvoice = {
  invoiceId: Hex;
  vendor: Address;
  payer: Address;
  token: Address;
  amount: bigint;
  payee: Address;
  dueDate: bigint;
  expiry: bigint;
  nonce: bigint;
};

export const invoiceTypes = {
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
} as const;

export function toChainInvoice(invoice: Invoice): ChainInvoice {
  return {
    invoiceId: invoice.invoiceId,
    vendor: invoice.vendor,
    payer: invoice.payer,
    token: invoice.token,
    amount: BigInt(invoice.amount),
    payee: invoice.payee,
    dueDate: BigInt(invoice.dueDate),
    expiry: BigInt(invoice.expiry),
    nonce: BigInt(invoice.nonce),
  };
}

export function invoiceDigest(invoice: Invoice, chainId: number, verifyingContract: Address): Hex {
  return hashTypedData({
    domain: { name: "SealPay", version: "1", chainId, verifyingContract },
    types: invoiceTypes,
    primaryType: "Invoice",
    message: toChainInvoice(invoice),
  });
}

export function newInvoiceId(seed: string): Hex {
  return keccak256(stringToHex(seed));
}

export function isHex(value: unknown): value is Hex {
  return typeof value === "string" && /^0x[0-9a-fA-F]*$/.test(value);
}

export function shortAddress(address?: string): string {
  if (!address) return "";
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function formatUnits6(value: bigint | string): string {
  const raw = typeof value === "bigint" ? value : BigInt(value || "0");
  const whole = raw / 1_000_000n;
  const frac = (raw % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole.toString();
}

export function parseUnits6(value: string): bigint {
  const [whole, frac = ""] = value.trim().split(".");
  if (!/^\d*$/.test(whole) || !/^\d*$/.test(frac)) throw new Error("Invalid amount");
  return BigInt(whole || "0") * 1_000_000n + BigInt(frac.padEnd(6, "0").slice(0, 6) || "0");
}

export function toDatetimeLocal(timestampSeconds: number): string {
  const date = new Date(timestampSeconds * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(
    date.getMinutes()
  )}`;
}

export function fromDatetimeLocal(value: string): number {
  return Math.floor(new Date(value).getTime() / 1000);
}

export function demoInvoice(overrides: Partial<Invoice> & Pick<Invoice, "vendor">): Invoice {
  const now = Math.floor(Date.now() / 1000);
  const { vendor, ...rest } = overrides;
  return {
    invoiceId: newInvoiceId(`sealpay-${vendor}-${now}-${Math.random()}`),
    vendor,
    payer: "0x0000000000000000000000000000000000000000",
    token: (process.env.NEXT_PUBLIC_TUSD8_ADDRESS as Address) ?? "0x456569838f1d43009A91ebA4263147Afd7233483",
    amount: "4200000000",
    payee: vendor,
    dueDate: now + 7 * 24 * 60 * 60,
    expiry: now + 30 * 24 * 60 * 60,
    nonce: now,
    ...rest,
  };
}
