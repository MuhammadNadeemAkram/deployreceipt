import { EvidencePreview } from "./evidence-preview";
import type {
  ReleaseReview,
  ReviewEvidence,
  ReviewComment,
  ReviewDecision,
} from "../types";
import { ReviewCommentForm, ResolveFeedbackForm, DecisionForm } from "./forms";
export function ReviewContent({
  review,
  evidence,
  comments,
  decisions,
  owner = false,
  now,
}: {
  review: ReleaseReview;
  evidence: ReviewEvidence[];
  comments: ReviewComment[];
  decisions: ReviewDecision[];
  owner?: boolean;
  now: number;
}) {
  const s = review.snapshot;
  return (
    <>
      <section className="review-hero">
        <p className="eyebrow">
          {s.project_name} · RELEASE REVIEW v{review.version}
        </p>
        <h1>{review.title}</h1>
        <p>
          State: <strong>{review.status.replaceAll("_", " ")}</strong> · Created{" "}
          {new Date(review.created_at).toISOString()}
        </p>
        <p>
          Review access expires {new Date(review.expires_at).toISOString()}.
          Screenshot access may expire earlier.
        </p>
        <p className="review-url">Stored scan target: {s.target_url}</p>
        <p className="field-hint">
          This immutable snapshot is bound to report {review.report_id} and scan{" "}
          {review.scan_run_id}.
        </p>
        <details>
          <summary>Version integrity digest (SHA-256)</summary>
          <code className="review-digest">{review.snapshot_digest}</code>
        </details>
      </section>
      <div className="report-summary">
        <div>
          <strong>{s.passed}</strong>
          <span>Observed passes</span>
        </div>
        <div className="review-alert">
          <strong>{s.failed}</strong>
          <span>Failed checks — review explicitly</span>
        </div>
        <div className="review-alert">
          <strong>{s.warnings}</strong>
          <span>Warnings — review explicitly</span>
        </div>
      </div>
      <section className="scan-panel report-panel">
        <h2>Release notes</h2>
        <p className="review-prose">
          {review.release_notes || "No release notes provided."}
        </p>
        <h3>Scope and limitations</h3>
        <p>
          Scan date: {s.scan_date}. One target, desktop and mobile viewports,
          and a bounded internal-link check. Automated outcomes remain separate
          from human review.
        </p>
        {!s.configuration && (
          <p>Historical execution configuration was not recorded.</p>
        )}
        {!s.authorization && (
          <p>
            Historical target authorization was not recorded; this is not a
            fresh verification claim.
          </p>
        )}
        <ul>
          {s.limitations.map((v, i) => (
            <li key={i}>{v}</li>
          ))}
        </ul>
      </section>
      <section className="scan-panel report-panel">
        <h2>Findings in this version</h2>
        {s.findings.map((f) => (
          <article key={f.id} className="review-finding" id={`finding-${f.id}`}>
            <p className="eyebrow">
              {f.type} ·{" "}
              <span className="scan-status" data-status={f.outcome}>
                {f.outcome.toUpperCase()}
              </span>
            </p>
            <h3>{f.description}</h3>
            <p>
              Human severity: {f.severity ?? "Untriaged"} · Resolution at
              snapshot: {f.resolution}
            </p>
            <p className="review-prose">
              {f.notes || "No developer explanation added."}
            </p>
            {f.comments.map((c, i) => (
              <blockquote key={i}>
                <p className="review-prose">{c.body}</p>
                <footer>Developer note at {c.created_at}</footer>
              </blockquote>
            ))}
            {f.evidence_ids.length > 0 && (
              <p>
                Supporting screenshots:{" "}
                {f.evidence_ids
                  .map(
                    (id) =>
                      evidence.find((e) => e.check_id === id)?.kind ??
                      "Unavailable",
                  )
                  .join(", ")}
              </p>
            )}
            <details>
              <summary>Original technical observation</summary>
              <pre className="scan-details">
                {JSON.stringify(f.details, null, 2)}
              </pre>
            </details>
          </article>
        ))}
      </section>
      <section className="scan-panel report-panel">
        <h2>Screenshot evidence</h2>
        <p>
          Evidence uses the original scan retention policy. No screenshot is
          recreated or retained longer for this review. Unavailable images are
          labeled by the evidence endpoint.
        </p>
        {!evidence.length && <p>No screenshot evidence was recorded.</p>}
        <div className="review-evidence">
          {evidence.map((e) => (
            <div key={e.check_id}>
              <h3>{e.kind} viewport</h3>
              <p>
                Evidence access expires {new Date(e.expires_at).toISOString()}{" "}
                or earlier under the current scan retention policy.
              </p>
              {Date.parse(e.expires_at) <= now ? (
                <p role="status">
                  Evidence expired. No substitute image is available.
                </p>
              ) : (
                <EvidencePreview
                  url={`/api/reviews/${review.id}/evidence/${e.check_id}`}
                  kind={e.kind}
                />
              )}
            </div>
          ))}
        </div>
      </section>
      <section className="scan-panel report-panel">
        <h2>Decision history</h2>
        {!decisions.length ? (
          <p>No decision recorded for this version.</p>
        ) : (
          decisions.map((d) => (
            <div key={d.id}>
              <h3>
                {d.decision.replaceAll("_", " ")} · version {d.version}
              </h3>
              <p>
                Recorded {d.created_at} by authenticated reviewer{" "}
                {d.reviewer_id}.
              </p>
              <p className="review-prose">{d.notes || "No decision notes."}</p>
              <p className="field-hint">
                Decision binds to digest {d.snapshot_digest}.
              </p>
            </div>
          ))
        )}
      </section>
      <section className="scan-panel report-panel">
        <h2>Client feedback and developer replies</h2>
        <p>
          {
            comments.filter(
              (c) => c.kind === "change_request" && !c.resolved_at,
            ).length
          }{" "}
          unresolved change requests in this version.
        </p>
        {comments.map((c) => (
          <article className="review-finding" key={c.id} id={`comment-${c.id}`}>
            <p>
              <strong>
                {c.author_role === "developer"
                  ? "Developer"
                  : "Client reviewer"}
              </strong>{" "}
              · {c.created_at} · {c.kind.replaceAll("_", " ")}
            </p>
            {c.finding_id && (
              <a href={`#finding-${c.finding_id}`}>Related finding</a>
            )}
            {c.parent_id && (
              <p>
                <a href={`#comment-${c.parent_id}`}>
                  Reply to earlier feedback
                </a>
              </p>
            )}
            <p className="review-prose">{c.content}</p>
            <p>
              {c.resolved_at ? `Resolved ${c.resolved_at}` : "Open feedback"}
            </p>
            {owner && <ResolveFeedbackForm reviewId={review.id} comment={c} />}
          </article>
        ))}
        {["pending_review", "approved", "changes_requested"].includes(
          review.status,
        ) && <ReviewCommentForm review={review} comments={comments} />}
      </section>
      {!owner && review.status === "pending_review" && (
        <section className="scan-panel report-panel">
          <h2>Your release decision</h2>
          <DecisionForm review={review} />
        </section>
      )}
    </>
  );
}
