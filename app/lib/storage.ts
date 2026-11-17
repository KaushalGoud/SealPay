import type { SignedInvoice, Invoice } from "./invoice";
import type { VendorKey } from "./mldsa";

const VENDOR_KEY = "sealpay.vendorKey";
const LAST_INVOICE = "sealpay.lastInvoice";
const INVOICES = "sealpay.invoices";

function read<T>(key: string): T | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(key, JSON.stringify(value));
}

export const loadVendorKey = () => read<VendorKey>(VENDOR_KEY);
export const saveVendorKey = (key: VendorKey) => write(VENDOR_KEY, key);
export const clearVendorKey = () => window.localStorage.removeItem(VENDOR_KEY);

export const loadLastInvoice = () => read<SignedInvoice>(LAST_INVOICE);
export const saveLastInvoice = (invoice: SignedInvoice) => {
  write(LAST_INVOICE, invoice);
  const all = loadInvoices();
  write(INVOICES, [invoice, ...all].slice(0, 25));
};
export const loadInvoices = () => read<SignedInvoice[]>(INVOICES) ?? [];
export const saveInvoice = (invoice: SignedInvoice) => saveLastInvoice(invoice);
export const loadInvoice = (invoiceId: string) =>
  loadInvoices().find((item) => item.invoice.invoiceId === invoiceId) ?? null;
export type { Invoice, SignedInvoice };
