"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useAccount, useReadContract, useWaitForTransactionReceipt, useWriteContract } from "wagmi";
import { zeroAddress, type Address, type Hex } from "viem";
import {
  REGISTRY_ADDRESS,
  SEALPAY_ADDRESS,
  TUSD8_ADDRESS,
  aevum,
  explorerAddress,
  explorerTx,
} from "@/lib/chain";
import { registryAbi, sealPayAbi } from "@/lib/contracts";
import {
  demoInvoice,
  formatUnits6,
  fromDatetimeLocal,
  invoiceDigest,
  newInvoiceId,
  parseUnits6,
  shortAddress,
  toChainInvoice,
  toDatetimeLocal,
  type Invoice,
  type SignedInvoice,
} from "@/lib/invoice";
import { generateVendorKey, signDigest, type VendorKey } from "@/lib/mldsa";
import { loadLastInvoice, loadVendorKey, saveLastInvoice, saveVendorKey } from "@/lib/storage";

type FormState = {
  payer: string;
  payee: string;
  amount: string;
  due: string;
  expiry: string;
};

export default function VendorPage() {
  const { address, isConnected } = useAccount();
  const [mounted, setMounted] = useState(false);
  const [key, setKey] = useState<VendorKey | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signed, setSigned] = useState<SignedInvoice | null>(null);
  const [form, setForm] = useState<FormState>(() => {
    const now = Math.floor(Date.now() / 1000);
    return {
      payer: "",
      payee: "",
      amount: "4200",
      due: toDatetimeLocal(now + 7 * 24 * 60 * 60),
      expiry: toDatetimeLocal(now + 30 * 24 * 60 * 60),
    };
  });

  useEffect(() => {
    setMounted(true);
    const stored = loadVendorKey();
    if (stored) setKey(stored);
    setSigned(loadLastInvoice());
  }, []);

  useEffect(() => {
    if (address && !form.payee) {
      setForm((current) => ({ ...current, payee: address }));
    }
  }, [address, form.payee]);

  const registryReady = Boolean(REGISTRY_ADDRESS);
  const sealPayReady = Boolean(SEALPAY_ADDRESS);

  const { data: registered, refetch: refetchRegistered } = useReadContract({
    address: REGISTRY_ADDRESS,
    abi: registryAbi,
    functionName: "isRegistered",
    args: address ? [address] : undefined,
    query: { enabled: Boolean(address && registryReady) },
  });

  const { writeContractAsync } = useWriteContract();
  const [txHash, setTxHash] = useState<Hex | undefined>();
  const { isLoading: confirming, isSuccess: confirmed } = useWaitForTransactionReceipt({ hash: txHash });

  useEffect(() => {
    if (confirmed) refetchRegistered();
  }, [confirmed, refetchRegistered]);

  const keyHash = useMemo(() => (key ? key.publicKey.slice(0, 18) + "…" + key.publicKey.slice(-12) : ""), [key]);

  async function handleGenerate() {
    setError(null);
    setBusy(true);
    try {
      const next = generateVendorKey();
      setKey(next);
      saveVendorKey(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Key generation failed");
    } finally {
      setBusy(false);
    }
  }

  async function handleRegisterKey() {
    if (!address || !key || !REGISTRY_ADDRESS) return;
    setError(null);
    try {
      const hash = await writeContractAsync({
        address: REGISTRY_ADDRESS,
        abi: registryAbi,
        functionName: "register",
        args: [key.publicKey],
      });
      setTxHash(hash);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Registration failed");
    }
  }

  function handleSign() {
    if (!address) return;
    setError(null);
    try {
      if (!key) throw new Error("Generate a vendor key first");
      if (!SEALPAY_ADDRESS) throw new Error("Set NEXT_PUBLIC_SEALPAY_ADDRESS after deploying");

      const due = fromDatetimeLocal(form.due);
      const expiry = fromDatetimeLocal(form.expiry);
      if (!Number.isFinite(due) || !Number.isFinite(expiry)) throw new Error("Invalid dates");
      if (expiry <= Math.floor(Date.now() / 1000)) throw new Error("Expiry must be in the future");

      const invoice: Invoice = demoInvoice({
        vendor: address,
        payer: (form.payer.trim() || zeroAddress) as Address,
        payee: (form.payee.trim() || address) as Address,
        token: TUSD8_ADDRESS,
        amount: parseUnits6(form.amount).toString(),
        dueDate: due,
        expiry,
        nonce: Math.floor(Date.now() / 1000),
        invoiceId: newInvoiceId(`sealpay-${address}-${Date.now()}`),
      });

      const digest = invoiceDigest(invoice, aevum.id, SEALPAY_ADDRESS);
      const signature = signDigest(digest, key.secretKey);
      const bundle: SignedInvoice = { invoice, signature, digest, vendorPublicKey: key.publicKey, createdAt: Date.now() };
      setSigned(bundle);
      saveLastInvoice(bundle);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not sign invoice");
    }
  }

  async function handleRegisterInvoice() {
    if (!signed || !SEALPAY_ADDRESS) return;
    setError(null);
    try {
      const hash = await writeContractAsync({
        address: SEALPAY_ADDRESS,
        abi: sealPayAbi,
        functionName: "registerInvoice",
        args: [toChainInvoice(signed.invoice), signed.signature],
      });
      setTxHash(hash);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Registration failed");
    }
  }

  async function copyBundle() {
    if (!signed) return;
    await navigator.clipboard.writeText(JSON.stringify(signed, null, 2));
  }

  return (
    <div className="stack" style={{ gap: 22 }}>
      <div>
        <div className="eyebrow">Vendor console</div>
        <h1 style={{ fontSize: 38, margin: "10px 0 8px" }}>Create a signed invoice</h1>
        <p className="muted" style={{ maxWidth: 680 }}>
          Your ML-DSA key stays in this browser. The invoice is signed locally; the chain only ever sees the
          public key, the invoice fields and the signature.
        </p>
      </div>

      {!registryReady || !sealPayReady ? (
        <div className="banner warn">
          Contract addresses are not configured. Deploy the contracts with <span className="mono">forge script</span> and set{" "}
          <span className="mono">NEXT_PUBLIC_SEALPAY_ADDRESS</span> and{" "}
          <span className="mono">NEXT_PUBLIC_REGISTRY_ADDRESS</span> in <span className="mono">app/.env.local</span>.
        </div>
      ) : null}

      {error ? <div className="banner bad">{error}</div> : null}

      <div className="auth-grid">
        <section className="card stack">
          <div className="row between">
            <h2 style={{ margin: 0 }}>1. Vendor key</h2>
            <span className={`pill ${registered ? "ok" : "warn"}`}>
              {registered ? "registered on-chain" : "not registered"}
            </span>
          </div>

          {!isConnected ? (
            <p className="muted">Connect a wallet to act as the vendor.</p>
          ) : (
            <>
              <dl className="kv">
                <dt>Vendor</dt>
                <dd className="mono">{address}</dd>
                <dt>Public key</dt>
                <dd className="mono">{key ? keyHash : "no key yet"}</dd>
              </dl>

              <div className="row">
                <button className="btn ghost" onClick={handleGenerate} disabled={busy}>
                  {key ? "Regenerate key" : busy ? "Generating…" : "Generate ML-DSA key"}
                </button>
                <button className="btn" onClick={handleRegisterKey} disabled={!key || registered || confirming}>
                  {confirming ? "Confirming…" : registered ? "Key registered" : "Register key on-chain"}
                </button>
              </div>

              {key ? (
                <div className="banner">
                  This is a demo key stored in <span className="mono">localStorage</span>. Do not use it for real
                  funds.
                </div>
              ) : null}
            </>
          )}
        </section>

        <section className="card stack">
          <h2 style={{ margin: 0 }}>2. Invoice terms</h2>
          <div className="field">
            <span>Payer address (optional)</span>
            <input
              placeholder="0x… (leave blank for open invoice)"
              value={form.payer}
              onChange={(e) => setForm({ ...form, payer: e.target.value })}
            />
          </div>
          <div className="field">
            <span>Payee address</span>
            <input
              placeholder={address ?? "0x…"}
              value={form.payee}
              onChange={(e) => setForm({ ...form, payee: e.target.value })}
            />
          </div>
          <div className="grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
            <div className="field">
              <span>Amount (tUSD8)</span>
              <input
                inputMode="decimal"
                value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value })}
              />
            </div>
            <div className="field">
              <span>Token</span>
              <input value={TUSD8_ADDRESS} readOnly className="mono" />
            </div>
          </div>
          <div className="grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
            <div className="field">
              <span>Due date</span>
              <input type="datetime-local" value={form.due} onChange={(e) => setForm({ ...form, due: e.target.value })} />
            </div>
            <div className="field">
              <span>Signature expiry</span>
              <input
                type="datetime-local"
                value={form.expiry}
                onChange={(e) => setForm({ ...form, expiry: e.target.value })}
              />
            </div>
          </div>
          <button className="btn wide" onClick={handleSign} disabled={!key || !isConnected}>
            Build &amp; sign invoice
          </button>
        </section>
      </div>

      {signed ? (
        <section className="card stack">
          <div className="row between">
            <h2 style={{ margin: 0 }}>3. Signed invoice</h2>
            <span className="pill ok">ML-DSA-44 signed</span>
          </div>
          <dl className="kv">
            <dt>Invoice id</dt>
            <dd className="mono">{signed.invoice.invoiceId}</dd>
            <dt>Amount</dt>
            <dd>{formatUnits6(signed.invoice.amount)} tUSD8</dd>
            <dt>Vendor</dt>
            <dd className="mono">{shortAddress(signed.invoice.vendor)}</dd>
            <dt>Payee</dt>
            <dd className="mono">{shortAddress(signed.invoice.payee)}</dd>
            <dt>Expires</dt>
            <dd>{new Date(signed.invoice.expiry * 1000).toLocaleString()}</dd>
            <dt>Digest</dt>
            <dd className="mono">{signed.digest}</dd>
            <dt>Signature</dt>
            <dd className="mono">{signed.signature.slice(0, 40)}…</dd>
          </dl>
          <div className="row">
            <button className="btn ghost" onClick={copyBundle}>
              Copy invoice bundle
            </button>
            <button className="btn" onClick={handleRegisterInvoice} disabled={!sealPayReady || confirming}>
              {confirming ? "Confirming…" : "Register on-chain"}
            </button>
            <Link href="/pay" className="btn ghost">
              Go to payment
            </Link>
          </div>
          {txHash ? (
            <div className="banner ok">
              Transaction sent.{" "}
              <a href={explorerTx(txHash)} target="_blank" className="mono">
                View on explorer
              </a>
            </div>
          ) : null}
        </section>
      ) : (
        <div className="banner">Sign an invoice to see the bundle that the payer will verify.</div>
      )}

      <p className="small muted">
        Vendor key published as contract code at{" "}
        {REGISTRY_ADDRESS ? (
          <a href={explorerAddress(REGISTRY_ADDRESS)} target="_blank" className="mono">
            {shortAddress(REGISTRY_ADDRESS)}
          </a>
        ) : (
          "the registry"
        )}
        . The signature covers the EIP-712 domain (chain id + contract), so it cannot be replayed on another
        chain or contract.
      </p>
    </div>
  );
}
