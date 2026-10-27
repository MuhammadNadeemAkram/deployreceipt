import Link from "next/link";
import { site } from "@/lib/site";
import { Workflow } from "@/features/marketing/components/workflow";
import { ReleasePreview } from "@/features/marketing/components/release-preview";
export default function Home() {
  return (
    <main id="main-content">
      <section className="container hero" aria-labelledby="hero-title">
        <div>
          <p className="status">
            <span aria-hidden="true" />
            OPEN SOURCE · IN DEVELOPMENT
          </p>
          <h1 id="hero-title">
            Test. Review.
            <br />
            Approve. <span>Ship.</span>
          </h1>
          <p className="hero-description">
            A clearer handoff for every website release.
          </p>
          <p className="hero-detail">
            DeployReceipt is an open-source platform being built to help
            developers and agencies test websites, collect QA evidence, and
            manage client release approvals.
          </p>
          <div className="actions">
            <Link className="button" href="/get-started">
              Get Started <span aria-hidden="true">→</span>
            </Link>
            <a className="button secondary" href={site.github}>
              View on GitHub ↗
            </a>
          </div>
          <p className="footnote">
            Early development. Follow the build or contribute on GitHub.
          </p>
        </div>
        <ReleasePreview />
      </section>
      <div className="principles">
        <div className="container">
          <span>Built for developers & agencies</span>
          <span>Evidence before sign-off</span>
          <span>A record of every release</span>
        </div>
      </div>
      <Workflow />
      <section
        className="container open-source"
        aria-labelledby="contribute-title"
      >
        <div>
          <p className="eyebrow">BUILT IN THE OPEN</p>
          <h2 id="contribute-title">Help shape a better release process.</h2>
          <p>Explore the source, share an idea, or pick up an issue.</p>
        </div>
        <a className="button secondary" href={site.github}>
          Explore the repository ↗
        </a>
      </section>
    </main>
  );
}
