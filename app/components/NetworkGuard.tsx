"use client";

import { useAccount, useChainId, useSwitchChain } from "wagmi";
import { aevum } from "@/lib/chain";

export function NetworkGuard() {
  const { isConnected } = useAccount();
  const chainId = useChainId();
  const { switchChain, isPending } = useSwitchChain();

  if (!isConnected || chainId === aevum.id) return null;

  return (
    <div className="banner bad" style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
      <span style={{ flex: 1 }}>
        Wrong network: wallet is on chain {chainId}. SealPay transactions must be on QDay Aevum (44005).
      </span>
      <button className="btn sm" onClick={() => switchChain({ chainId: aevum.id })} disabled={isPending}>
        {isPending ? "Switching…" : "Switch to QDay Aevum"}
      </button>
    </div>
  );
}
