import type { Metadata } from "next";
import Link from "next/link";
import { site } from "@/lib/site";
export const metadata: Metadata = { title: "Coming soon" };
export default function GetStarted() {
  return (
    <main id="main-content" className="container coming-soon">
      <p className="status">IN DEVELOPMENT</p>
      <h1>
        A clearer release process
        <br />
        is on its way.
      </h1>
      <p>
        DeployReceipt is coming soon. Account creation, website checks, reports,
        and approval workflows are not available yet.
      </p>
      <p>Follow development and contribute ideas in the GitHub repository.</p>
      <div className="actions">
        <a className="button" href={site.github}>
          Follow on GitHub ↗
        </a>
        <Link className="button secondary" href="/">
          Back to home
        </Link>
      </div>
    </main>
  );
}
