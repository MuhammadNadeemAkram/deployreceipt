import Link from "next/link";
import { site } from "@/lib/site";
export function SiteHeader() {
  return (
    <header className="container header">
      <Link href="/" className="brand">
        <span aria-hidden="true" className="mark">
          ✓
        </span>
        DeployReceipt
      </Link>
      <nav aria-label="Main navigation">
        <Link href="/#workflow">How it works</Link>
        <a href={site.github}>GitHub ↗</a>
        <Link href="/login">Sign in</Link>
        <Link className="button small" href="/get-started">
          Get Started
        </Link>
      </nav>
    </header>
  );
}
