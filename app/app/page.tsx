import Link from "next/link";

export default function Home() {
  return (
    <>
      <section className="hero">
        <div className="eyebrow">Post-quantum invoice settlement · QDay Aevum</div>
        <h1>
          Invoices that <span className="grad">cannot be forged</span>, even by an AI agent.
        </h1>
        <p className="lead">
          A vendor signs the invoice object with ML-DSA, NIST&apos;s post-quantum signature scheme. The
          payment contract verifies that signature on-chain before releasing tUSD8. Change the amount, the
          payee, or the due date and the payment reverts.
        </p>
        <div className="row">
          <Link href="/vendor" className="btn">
            Create a signed invoice
          </Link>
          <Link href="/pay" className="btn ghost">
            Verify &amp; pay
          </Link>
        </div>
      </section>

      <section style={{ marginTop: 40 }}>
        <div className="grid">
          <div className="card">
            <h3>Signed object, not text</h3>
            <p>
              The invoice is an EIP-712 struct. Its digest binds chain id, contract address, invoice id,
              vendor, payer, token, amount, payee, due date, expiry and nonce.
            </p>
          </div>
          <div className="card">
            <h3>ML-DSA-44 on-chain</h3>
            <p>
              FIPS 204 lattice signatures are verified in Solidity. There is no precompile and no trusted
              oracle: the contract itself checks the vendor&apos;s signature.
            </p>
          </div>
          <div className="card">
            <h3>Agent-safe by construction</h3>
            <p>
              A prompt-injected agent can change what it <em>says</em>, but it cannot change what the vendor{" "}
              <em>signed</em>. A payment policy caps what the agent can spend anyway.
            </p>
          </div>
        </div>
      </section>

      <section style={{ marginTop: 44 }}>
        <div className="section-head">
          <h2>How a payment works</h2>
          <span className="pill">chain 44005 · tUSD8</span>
        </div>
        <div className="grid">
          <div className="card">
            <div className="steps">
              <div className="step">
                <div>
                  <h3>Vendor signs</h3>
                  <p>The vendor&apos;s browser generates an ML-DSA key and signs the invoice digest.</p>
                </div>
              </div>
              <div className="step">
                <div>
                  <h3>Key is registered</h3>
                  <p>The public key is published on-chain and bound to the vendor payout address.</p>
                </div>
              </div>
              <div className="step">
                <div>
                  <h3>Payer verifies &amp; pays</h3>
                  <p>The contract reconstructs the digest, checks the signature, then moves tUSD8.</p>
                </div>
              </div>
            </div>
          </div>
          <div className="card">
            <h3>Try the tamper demo</h3>
            <p style={{ marginBottom: 14 }}>
              Open Pay, load the invoice you signed, then flip one field. The local verifier turns red and the
              on-chain call reverts with <span className="mono">InvalidSignature</span>.
            </p>
            <Link href="/vendor" className="btn wide">
              Start with an invoice
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
