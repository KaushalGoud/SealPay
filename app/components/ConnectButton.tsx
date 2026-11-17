"use client";

import { useEffect, useState } from "react";
import { useAccount, useConnect, useDisconnect } from "wagmi";
import { shortAddress } from "@/lib/invoice";

export function ConnectButton() {
  const [mounted, setMounted] = useState(false);
  const { address, isConnected } = useAccount();
  const { connect, connectors, isPending } = useConnect();
  const { disconnect } = useDisconnect();

  useEffect(() => setMounted(true), []);

  if (!mounted) return <button className="btn ghost">Connect wallet</button>;

  if (isConnected && address) {
    return (
      <button className="btn ghost" onClick={() => disconnect()} title="Disconnect">
        <span className="dot" /> {shortAddress(address)}
      </button>
    );
  }

  const injected = connectors[0];
  return (
    <button className="btn" disabled={isPending} onClick={() => injected && connect({ connector: injected })}>
      {isPending ? "Connecting…" : "Connect wallet"}
    </button>
  );
}
