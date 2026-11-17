import type { Metadata } from "next";
import Link from "next/link";
import { ConnectButton } from "@/components/ConnectButton";
import { NetworkGuard } from "@/components/NetworkGuard";
import { Providers } from "./providers";
import "./globals.css";

export const metadata: Metadata = {
  title: "SealPay — signed invoices for the agent economy",
  description:
    "Vendor-signed invoices with ML-DSA post-quantum signatures, verified on-chain before tUSD8 moves.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>
          <div className="shell">
            <header className="topbar">
              <Link href="/" className="brand">
                <span className="brand-mark">◈</span> SealPay
              </Link>
              <nav className="nav">
                <Link href="/vendor">Vendor</Link>
                <Link href="/pay">Pay</Link>
                <Link href="/agent">Agent</Link>
              </nav>
              <ConnectButton />
            </header>
            <NetworkGuard />
            <main className="main">{children}</main>
            <footer className="footer">
              <span>QDay Aevum testnet · chain 44005</span>
              <span>ML-DSA-44 · FIPS 204</span>
            </footer>
          </div>
        </Providers>
      </body>
    </html>
  );
}
