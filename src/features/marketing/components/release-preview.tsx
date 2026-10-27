export function ReleasePreview() {
  return (
    <figure className="receipt" aria-labelledby="receipt-caption">
      <div className="receipt-top">
        <span>DEPLOYRECEIPT / RELEASE OVERVIEW</span>
        <span className="sample">Illustration</span>
      </div>
      <div className="receipt-body">
        <div className="receipt-heading">
          <span className="document" aria-hidden="true">
            ≡
          </span>
          <div>
            <p className="eyebrow">ONE SHARED RELEASE RECORD</p>
            <h2>Your next release</h2>
          </div>
        </div>
        <p className="receipt-description">
          Give every review the context it needs.
        </p>
        <ol className="receipt-steps">
          {["Website checks", "Evidence & review", "Client approval"].map(
            (step, i) => (
              <li key={step}>
                <span className="number">0{i + 1}</span>
                {step}
                <span className="step-line" aria-hidden="true" />
              </li>
            ),
          )}
        </ol>
        <div className="receipt-note">
          ↳ Evidence, decisions, and sign-off. Together.
        </div>
      </div>
      <figcaption id="receipt-caption">
        Planned workflow preview. Product features are in development.
      </figcaption>
    </figure>
  );
}
