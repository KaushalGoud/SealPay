"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useAccount, useReadContract, useWaitForTransactionReceipt, useWriteContract } from "wagmi";
import type { Hex } from "viem";
import {
  POLICY_ADDRESS,
  REGISTRY_ADDRESS,
  SEALPAY_ADDRESS,
  TUSD8_ADDRESS,
  aevum,
  explorerTx,
} from "@/lib/chain";
import { erc20Abi, registryAbi, sealPayAbi } from "@/lib/contracts";
import {
  formatUnits6,
  invoiceDigest,
  shortAddress,
  toChainInvoice,
  type SignedInvoice,
} from "@/lib/invoice";
import { verifyDigest } from "@/lib/mldsa";
import { loadLastInvoice } from "@/lib/storage";

type VerifyState = "idle" | "valid" | "invalid" | "missing";

export default function PayPage() {
  const { address, isConnected } = useAccount();
  const [text, setText] = useState("");
  const [bundle, setBundle] = useState<SignedInvoice | null>(null);
  const [tampered, setTampered] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    const stored = loadLastInvoice();
    if (stored) {
      setBundle(stored);
      setText(JSON.stringify(stored, null, 2));
    }
  }, []);

  const invoice = bundle?.invoice ?? null;
  const effectiveInvoice = useMemo(() => {
    if (!invoice) return null;
    if (!tampered) return invoice;
    return { ...invoice, amount: (BigInt(invoice.amount) * 10n).toString() };
  }, [invoice, tampered]);

  const digest = useMemo(() => {
    if (!effectiveInvoice || !SEALPAY_ADDRESS) return undefined;
    return invoiceDigest(effectiveInvoice, aevum.id, SEALPAY_ADDRESS);
  }, [effectiveInvoice]);

  const { data: publicKey } = useReadContract({
    address: REGISTRY_ADDRESS,
    abi: registryAbi,
    functionName: "getPublicKey",
    args: invoice ? [invoice.vendor] : undefined,
    query: { enabled: Boolean(invoice && REGISTRY_ADDRESS) },
  });

  const verifyState: VerifyState = useMemo(() => {
    if (!bundle || !digest) return "idle";
    if (!publicKey || publicKey === "0x") return "missing";
    return verifyDigest(digest, bundle.signature, publicKey as Hex) ? "valid" : "invalid";
  }, [bundle, digest, publicKey]);

  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    address: TUSD8_ADDRESS,
    abi: erc20Abi,
    functionName: "allowance",
    args: address && SEALPAY_ADDRESS ? [address, SEALPAY_ADDRESS] : undefined,
    query: { enabled: Boolean(address && SEALPAY_ADDRESS) },
  });

  const { data: balance } = useReadContract({
    address: TUSD8_ADDRESS,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: Boolean(address) },
  });

  const { data: record, refetch: refetchRecord } = useReadContract({
    address: SEALPAY_ADDRESS,
    abi: sealPayAbi,
    functionName: "getInvoice",
    args: invoice ? [invoice.invoiceId] : undefined,
    query: { enabled: Boolean(invoice && SEALPAY_ADDRESS) },
  });

  const { writeContractAsync } = useWriteContract();
  const [txHash, setTxHash] = useState<Hex | undefined>();
  const { isLoading: confirming, isSuccess: confirmed } = useWaitForTransactionReceipt({ hash: txHash });

  useEffect(() => {
    if (confirmed) {
      refetchAllowance();
      refetchRecord();
    }
  }, [confirmed, refetchAllowance, refetchRecord]);

  const amount = effectiveInvoice ? BigInt(effectiveInvoice.amount) : 0n;
  const needsApproval = allowance !== undefined && allowance < amount;
  const alreadyPaid = record ? Number(record[8]) === 2 : false;
  const payerMismatch =
    Boolean(invoice && invoice.payer !== "0x0000000000000000000000000000000000000000") &&
    Boolean(address) &&
    invoice!.payer.toLowerCase() !== address!.toLowerCase();

  function loadBundle() {
    setError(null);
    setNotice(null);
    try {
      const parsed = JSON.parse(text) as SignedInvoice;
      if (!parsed.invoice || !parsed.signature) throw new Error("Missing invoice or signature");
      setBundle(parsed);
      setTampered(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Invalid invoice JSON");
    }
  }

  async function handleApprove() {
    if (!SEALPAY_ADDRESS || !effectiveInvoice) return;
    setError(null);
    try {
      const hash = await writeContractAsync({
        address: TUSD8_ADDRESS,
        abi: erc20Abi,
        functionName: "approve",
        args: [SEALPAY_ADDRESS, amount],
      });
      setTxHash(hash);
      setNotice("Approval submitted. Once confirmed, pay the invoice.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Approval failed");
    }
  }

  async function handlePay() {
    if (!SEALPAY_ADDRESS || !effectiveInvoice || !bundle) return;
    setError(null);
    setNotice(null);
    try {
      const hash = await writeContractAsync({
        address: SEALPAY_ADDRESS,
        abi: sealPayAbi,
        functionName: "payInvoice",
        args: [toChainInvoice(effectiveInvoice), bundle.signature],
      });
      setTxHash(hash);
      setNotice("Payment submitted. The contract is verifying the ML-DSA signature on-chain.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Payment reverted");
    }
  }

  return (
    <div className="stack" style={{ gap: 22 }}>
      <div>
        <div className="eyebrow">Payer console</div>
        <h1 style={{ fontSize: 38, margin: "10px 0 8px" }}>Verify &amp; pay</h1>
        <p className="muted" style={{ maxWidth: 680 }}>
          The invoice is verified locally for feedback, then verified again by the contract before tUSD8 moves.
          Flip a field to watch the signature fail.
        </p>
      </div>

      {!SEALPAY_ADDRESS || !REGISTRY_ADDRESS ? (
        <div className="banner warn">
          Set <span className="mono">NEXT_PUBLIC_SEALPAY_ADDRESS</span> and{" "}
          <span className="mono">NEXT_PUBLIC_REGISTRY_ADDRESS</span> in{" "}
          <span className="mono">app/.env.local</span> after deploying.
        </div>
      ) : null}

      {error ? <div className="banner bad">{error}</div> : null}
      {notice ? <div className="banner ok">{notice}</div> : null}

      <div className="auth-grid">
        <section className="card stack">
          <h2 style={{ margin: 0 }}>Invoice bundle</h2>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder='Paste the JSON bundle from the vendor console, e.g. {"invoice":{...},"signature":"0x..."}'
          />
          <div className="row">
            <button className="btn" onClick={loadBundle}>
              Load bundle
            </button>
            <button
              className="btn ghost"
              onClick={() => {
                const stored = loadLastInvoice();
                if (stored) {
                  setBundle(stored);
                  setText(JSON.stringify(stored, null, 2));
                  setTampered(false);
                }
              }}
            >
              Load last signed invoice
            </button>
            <Link href="/vendor" className="btn ghost">
              Create one
            </Link>
          </div>
        </section>

        <section className="card stack">
          <div className="row between">
            <h2 style={{ margin: 0 }}>Payment preview</h2>
            <span
              className={`pill ${
                verifyState === "valid" ? "ok" : verifyState === "invalid" ? "bad" : verifyState === "missing" ? "warn" : ""
              }`}
            >
              {verifyState === "valid"
                ? "signature valid"
                : verifyState === "invalid"
                  ? "signature invalid"
                  : verifyState === "missing"
                    ? "vendor key not registered"
                    : "waiting for bundle"}
            </span>
          </div>

          {effectiveInvoice ? (
            <>
              <dl className="kv">
                <dt>Invoice id</dt>
                <dd className="mono">{effectiveInvoice.invoiceId}</dd>
                <dt>Amount</dt>
                <dd>
                  {formatUnits6(effectiveInvoice.amount)} tUSD8{" "}
                  {tampered ? <span className="pill bad">tampered</span> : null}
                </dd>
                <dt>Vendor</dt>
                <dd className="mono">{effectiveInvoice.vendor}</dd>
                <dt>Payee</dt>
                <dd className="mono">{effectiveInvoice.payee}</dd>
                <dt>Payer</dt>
                <dd className="mono">
                  {effectiveInvoice.payer === "0x0000000000000000000000000000000000000000"
                    ? "open invoice"
                    : effectiveInvoice.payer}
                </dd>
                <dt>Due</dt>
                <dd>{new Date(effectiveInvoice.dueDate * 1000).toLocaleString()}</dd>
                <dt>Expires</dt>
                <dd>{new Date(effectiveInvoice.expiry * 1000).toLocaleString()}</dd>
                <dt>Digest</dt>
                <dd className="mono">{digest}</dd>
                <dt>On-chain</dt>
                <dd>{alreadyPaid ? "paid" : record && Number(record[8]) === 1 ? "registered" : "not registered"}</dd>
              </dl>

              <div className="row">
                <button className="btn ghost" onClick={() => setTampered((value) => !value)}>
                  {tampered ? "Restore invoice" : "Tamper with amount (×10)"}
                </button>
                {tampered ? <span className="pill bad">paying this will revert</span> : null}
              </div>

              <div className="divider" />

              {!isConnected ? (
                <div className="banner">Connect a wallet to pay.</div>
              ) : payerMismatch ? (
                <div className="banner bad">This invoice names a different payer: {shortAddress(invoice?.payer)}</div>
              ) : alreadyPaid ? (
                <div className="banner ok">This invoice is already paid. Replay is blocked by the contract.</div>
              ) : (
                <>
                  <div className="row between">
                    <span className="muted small">
                      Balance {balance !== undefined ? formatUnits6(balance) : "—"} tUSD8
                    </span>
                    <span className="muted small">
                      Allowance {allowance !== undefined ? formatUnits6(allowance) : "—"} tUSD8
                    </span>
                  </div>
                  {needsApproval ? (
                    <button className="btn wide" onClick={handleApprove} disabled={confirming}>
                      {confirming ? "Confirming…" : `Approve ${formatUnits6(amount)} tUSD8`}
                    </button>
                  ) : null}
                  <button className="btn wide" onClick={handlePay} disabled={confirming || needsApproval}>
                    {confirming ? "Confirming…" : `Pay ${formatUnits6(amount)} tUSD8`}
                  </button>
                  {POLICY_ADDRESS ? (
                    <p className="small muted">
                      Paying through an agent? Use the <Link href="/agent">Agent console</Link>.
                    </p>
                  ) : null}
                </>
              )}

              {txHash ? (
                <div className="banner ok">
                  <a href={explorerTx(txHash)} target="_blank" className="mono">
                    View transaction on the Aevum explorer
                  </a>
                </div>
              ) : null}
            </>
          ) : (
            <div className="banner">Load a signed invoice bundle to preview it.</div>
          )}
        </section>
      </div>
    </div>
  );
}
