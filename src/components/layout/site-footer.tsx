import { site } from "@/lib/site";
export function SiteFooter() {
  return (
    <footer className="container footer">
      <div>
        <strong>DeployReceipt</strong>
        <p>A clearer path from QA to release.</p>
      </div>
      <div className="footer-links">
        <span>Open source · Apache-2.0</span>
        <a href={site.github}>View on GitHub ↗</a>
      </div>
    </footer>
  );
}
