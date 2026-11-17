"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useAccount, useReadContract, useWaitForTransactionReceipt, useWriteContract } from "wagmi";
import type { Hex } from "viem";
import { POLICY_ADDRESS, REGISTRY_ADDRESS, SEALPAY_ADDRESS, TUSD8_ADDRESS, aevum, explorerTx } from "@/lib/chain";
import { erc20Abi, policyAbi, registryAbi, sealPayAbi } from "@/lib/contracts";
import {
  formatUnits6,
  invoiceDigest,
  shortAddress,
  toChainInvoice,
  type SignedInvoice,
} from "@/lib/invoice";
import { verifyDigest } from "@/lib/mldsa";
import { loadLastInvoice } from "@/lib/storage";

export default function AgentPage() {
  const { address, isConnected } = useAccount();
  const [bundle, setBundle] = useState<SignedInvoice | null>(null);
  const [text, setText] = useState("");
  const [injected, setInjected] = useState(false);
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
    if (!injected) return invoice;
    return { ...invoice, payee: "0x000000000000000000000000000000000000dEaD" as const };
  }, [invoice, injected]);

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

  const signatureValid = useMemo(() => {
    if (!bundle || !digest) return null;
    if (!publicKey || publicKey === "0x") return false;
    return verifyDigest(digest, bundle.signature, publicKey as Hex);
  }, [bundle, digest, publicKey]);

  const { data: policyPayer } = useReadContract({
    address: POLICY_ADDRESS,
    abi: policyAbi,
    functionName: "payer",
    query: { enabled: Boolean(POLICY_ADDRESS) },
  });

  const { data: policyAgent } = useReadContract({
    address: POLICY_ADDRESS,
    abi: policyAbi,
    functionName: "agent",
    query: { enabled: Boolean(POLICY_ADDRESS) },
  });

  const { data: perTxCap } = useReadContract({
    address: POLICY_ADDRESS,
    abi: policyAbi,
    functionName: "perTxCap",
    query: { enabled: Boolean(POLICY_ADDRESS) },
  });

  const { data: dailyCap } = useReadContract({
    address: POLICY_ADDRESS,
    abi: policyAbi,
    functionName: "dailyCap",
    query: { enabled: Boolean(POLICY_ADDRESS) },
  });

  const { data: remainingToday } = useReadContract({
    address: POLICY_ADDRESS,
    abi: policyAbi,
    functionName: "remainingToday",
    query: { enabled: Boolean(POLICY_ADDRESS) },
  });

  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    address: TUSD8_ADDRESS,
    abi: erc20Abi,
    functionName: "allowance",
    args: policyPayer && SEALPAY_ADDRESS ? [policyPayer, SEALPAY_ADDRESS] : undefined,
    query: { enabled: Boolean(policyPayer && SEALPAY_ADDRESS) },
  });

  const { data: expiresAt } = useReadContract({
    address: POLICY_ADDRESS,
    abi: policyAbi,
    functionName: "expiresAt",
    query: { enabled: Boolean(POLICY_ADDRESS) },
  });

  const { data: active, refetch: refetchActive } = useReadContract({
    address: POLICY_ADDRESS,
    abi: policyAbi,
    functionName: "active",
    query: { enabled: Boolean(POLICY_ADDRESS) },
  });

  const { data: vendorAllowed, refetch: refetchVendorAllowed } = useReadContract({
    address: POLICY_ADDRESS,
    abi: policyAbi,
    functionName: "allowedVendor",
    args: effectiveInvoice ? [effectiveInvoice.vendor] : undefined,
    query: { enabled: Boolean(effectiveInvoice && POLICY_ADDRESS) },
  });

  const { data: payeeAllowed, refetch: refetchPayeeAllowed } = useReadContract({
    address: POLICY_ADDRESS,
    abi: policyAbi,
    functionName: "allowedPayee",
    args: effectiveInvoice ? [effectiveInvoice.payee] : undefined,
    query: { enabled: Boolean(effectiveInvoice && POLICY_ADDRESS) },
  });

  const { writeContractAsync } = useWriteContract();
  const [txHash, setTxHash] = useState<Hex | undefined>();
  const { isLoading: confirming, isSuccess: confirmed } = useWaitForTransactionReceipt({ hash: txHash });

  useEffect(() => {
    if (confirmed) {
      refetchActive();
      refetchVendorAllowed();
      refetchPayeeAllowed();
      refetchAllowance();
    }
  }, [confirmed, refetchActive, refetchVendorAllowed, refetchPayeeAllowed, refetchAllowance]);

  const amount = effectiveInvoice ? BigInt(effectiveInvoice.amount) : 0n;
  const needsApproval = allowance !== undefined && amount > 0n && allowance < amount;
  const overPerTx = perTxCap !== undefined && amount > perTxCap;
  const overDaily = remainingToday !== undefined && amount > remainingToday;
  const expired = expiresAt !== undefined && BigInt(Math.floor(Date.now() / 1000)) > expiresAt;
  const wrongPayer =
    Boolean(effectiveInvoice && policyPayer) &&
    effectiveInvoice!.payer.toLowerCase() !== String(policyPayer).toLowerCase();
  const isAgent = Boolean(address && policyAgent && address.toLowerCase() === String(policyAgent).toLowerCase());
  const isPayer = Boolean(address && policyPayer && address.toLowerCase() === String(policyPayer).toLowerCase());
  const blocked = !signatureValid || overPerTx || overDaily || expired || wrongPayer || needsApproval || !active;

  async function handlePay() {
    if (!POLICY_ADDRESS || !effectiveInvoice || !bundle) return;
    setError(null);
    setNotice(null);
    try {
      const hash = await writeContractAsync({
        address: POLICY_ADDRESS,
        abi: policyAbi,
        functionName: "pay",
        args: [toChainInvoice(effectiveInvoice), bundle.signature],
      });
      setTxHash(hash);
      setNotice("Agent payment submitted. The policy and the vendor signature are checked on-chain.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Policy payment reverted");
    }
  }

  async function approve() {
    if (!SEALPAY_ADDRESS || !effectiveInvoice) return;
    setError(null);
    try {
      const hash = await writeContractAsync({
        address: TUSD8_ADDRESS,
        abi: erc20Abi,
        functionName: "approve",
        args: [SEALPAY_ADDRESS, BigInt(effectiveInvoice.amount)],
      });
      setTxHash(hash);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Approval failed");
    }
  }

  async function ownerCall(functionName: "setVendorAllowed" | "setPayeeAllowed", target: `0x${string}`) {
    if (!POLICY_ADDRESS) return;
    setError(null);
    try {
      const hash = await writeContractAsync({
        address: POLICY_ADDRESS,
        abi: policyAbi,
        functionName,
        args: [target, true],
      });
      setTxHash(hash);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Policy update failed");
    }
  }

  async function enableOperator() {
    if (!SEALPAY_ADDRESS) return;
    setError(null);
    try {
      const hash = await writeContractAsync({
        address: SEALPAY_ADDRESS,
        abi: sealPayAbi,
        functionName: "setOperator",
        args: [POLICY_ADDRESS as `0x${string}`, true],
      });
      setTxHash(hash);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not enable policy operator");
    }
  }

  return (
    <div className="stack" style={{ gap: 22 }}>
      <div>
        <div className="eyebrow">Agent console</div>
        <h1 style={{ fontSize: 38, margin: "10px 0 8px" }}>Scoped agent payments</h1>
        <p className="muted" style={{ maxWidth: 720 }}>
          An agent can propose and execute a payment, but only for a vendor-signed invoice, within the payer&apos;s
          per-transaction and daily caps, before expiry, and only to allowlisted vendors and payees. Prompt
          injection cannot rewrite a signed invoice.
        </p>
      </div>

      {!POLICY_ADDRESS ? (
        <div className="banner warn">
          No policy configured. Deploy one with{" "}
          <span className="mono">PAYER_ADDRESS=0x… AGENT_ADDRESS=0x… forge script script/Deploy.s.sol:Deploy …</span>{" "}
          or deploy <span className="mono">PaymentPolicy</span> separately, then set{" "}
          <span className="mono">NEXT_PUBLIC_POLICY_ADDRESS</span>.
        </div>
      ) : null}

      {error ? <div className="banner bad">{error}</div> : null}
      {notice ? <div className="banner ok">{notice}</div> : null}

      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
        <div className="card">
          <h3>Policy state</h3>
          <dl className="kv">
            <dt>Active</dt>
            <dd>{active ? "yes" : "no"}</dd>
            <dt>Agent</dt>
            <dd className="mono">{policyAgent ? shortAddress(String(policyAgent)) : "—"}</dd>
            <dt>Payer</dt>
            <dd className="mono">{policyPayer ? shortAddress(String(policyPayer)) : "—"}</dd>
            <dt>Per tx</dt>
            <dd>{perTxCap !== undefined ? formatUnits6(perTxCap) : "—"} tUSD8</dd>
            <dt>Daily</dt>
            <dd>{dailyCap !== undefined ? formatUnits6(dailyCap) : "—"} tUSD8</dd>
            <dt>Remaining</dt>
            <dd>{remainingToday !== undefined ? formatUnits6(remainingToday) : "—"} tUSD8</dd>
            <dt>Expires</dt>
            <dd>{expiresAt ? new Date(Number(expiresAt) * 1000).toLocaleString() : "—"}</dd>
          </dl>
        </div>

        <div className="card stack">
          <h3>Invoice under review</h3>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Paste a signed invoice bundle"
            style={{ minHeight: 120 }}
          />
          <div className="row">
            <button
              className="btn ghost sm"
              onClick={() => {
                try {
                  const parsed = JSON.parse(text) as SignedInvoice;
                  setBundle(parsed);
                  setInjected(false);
                  setError(null);
                } catch (e) {
                  setError(e instanceof Error ? e.message : "Invalid JSON");
                }
              }}
            >
              Load bundle
            </button>
            <button
              className="btn ghost sm"
              onClick={() => {
                const stored = loadLastInvoice();
                if (stored) {
                  setBundle(stored);
                  setText(JSON.stringify(stored, null, 2));
                  setInjected(false);
                }
              }}
            >
              Load last invoice
            </button>
          </div>
        </div>
      </div>

      {effectiveInvoice ? (
        <section className="card stack">
          <div className="row between">
            <h2 style={{ margin: 0 }}>Policy checks</h2>
            <span className={`pill ${blocked ? "bad" : "ok"}`}>{blocked ? "would revert" : "would pass"}</span>
          </div>

          <dl className="kv">
            <dt>Amount</dt>
            <dd>
              {formatUnits6(effectiveInvoice.amount)} tUSD8 {injected ? <span className="pill bad">payee injected</span> : null}
            </dd>
            <dt>Vendor</dt>
            <dd className="mono">{effectiveInvoice.vendor}</dd>
            <dt>Payee</dt>
            <dd className="mono">{effectiveInvoice.payee}</dd>
            <dt>Signature</dt>
            <dd>
              <span className={`pill ${signatureValid ? "ok" : "bad"}`}>
                {signatureValid ? "valid ML-DSA signature" : "invalid for these fields"}
              </span>
            </dd>
            <dt>Vendor allowed</dt>
            <dd>
              <span className={`pill ${vendorAllowed ? "ok" : "bad"}`}>{vendorAllowed ? "yes" : "no"}</span>
            </dd>
            <dt>Payee allowed</dt>
            <dd>
              <span className={`pill ${payeeAllowed ? "ok" : "bad"}`}>{payeeAllowed ? "yes" : "no"}</span>
            </dd>
            <dt>Per-tx cap</dt>
            <dd>
              <span className={`pill ${overPerTx ? "bad" : "ok"}`}>{overPerTx ? "exceeded" : "within cap"}</span>
            </dd>
            <dt>Daily cap</dt>
            <dd>
              <span className={`pill ${overDaily ? "bad" : "ok"}`}>{overDaily ? "exceeded" : "within cap"}</span>
            </dd>
            <dt>Expiry</dt>
            <dd>
              <span className={`pill ${expired ? "bad" : "ok"}`}>{expired ? "expired" : "active"}</span>
            </dd>
            <dt>Payer allowance</dt>
            <dd>
              <span className={`pill ${needsApproval ? "bad" : "ok"}`}>
                {allowance !== undefined ? formatUnits6(allowance) : "—"} tUSD8
              </span>
            </dd>
          </dl>

          <div className="row">
            <button className="btn ghost sm" onClick={() => setInjected((value) => !value)}>
              {injected ? "Restore signed payee" : "Simulate prompt injection"}
            </button>
            {injected ? <span className="pill bad">the signature no longer matches</span> : null}
          </div>

          <div className="divider" />

          {!isConnected ? (
            <div className="banner">Connect the agent wallet to execute.</div>
          ) : !isAgent ? (
            <div className="banner warn">
              Connected wallet is not the policy agent. The agent is {policyAgent ? shortAddress(String(policyAgent)) : "unset"}.
            </div>
          ) : (
            <button className="btn wide" onClick={handlePay} disabled={confirming}>
              {confirming ? "Confirming…" : blocked ? "Attempt payment (will revert)" : "Execute agent payment"}
            </button>
          )}

          {isPayer ? (
            <div className="banner">
              Payer setup: enable this policy as a SealPay operator, and allowlist the vendor and payee.
              <div className="row" style={{ marginTop: 10 }}>
                <button className="btn ghost sm" onClick={enableOperator}>
                  Enable policy operator
                </button>
                <button className="btn ghost sm" onClick={() => ownerCall("setVendorAllowed", effectiveInvoice.vendor)}>
                  Allow vendor
                </button>
                <button className="btn ghost sm" onClick={() => ownerCall("setPayeeAllowed", effectiveInvoice.payee)}>
                  Allow payee
                </button>
                <button className="btn ghost sm" onClick={approve}>
                  Approve {formatUnits6(amount)} tUSD8
                </button>
              </div>
            </div>
          ) : null}

          {txHash ? (
            <div className="banner ok">
              <a href={explorerTx(txHash)} target="_blank" className="mono">
                View transaction on the Aevum explorer
              </a>
            </div>
          ) : null}
        </section>
      ) : (
        <div className="banner">Load a signed invoice to see the policy checks.</div>
      )}

      <p className="small muted">
        Vendor allowlist and payee allowlist are enforced by the policy contract, not by the UI. The same is true
        of the caps and expiry. See <Link href="/pay">payer console</Link> for a direct payment.
      </p>
    </div>
  );
}
