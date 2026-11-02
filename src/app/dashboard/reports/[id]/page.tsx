import {
  ConfigurationSummary,
  AuthorizationSummary,
} from "@/features/reports/components/report-context";
import Link from "next/link";
import Image from "next/image";
import { ownedReport } from "@/features/reports/queries";
import { severities, resolutions } from "@/features/reports/model";
import {
  FindingTriageForm,
  FindingCommentForm,
} from "@/features/reports/components/finding-forms";
import { PdfExport } from "@/features/reports/components/pdf-export";
export const metadata = { title: "QA evidence report" };
export default async function ReportDetail({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    severity?: string;
    resolution?: string;
    outcome?: string;
  }>;
}) {
  const { model } = await ownedReport((await params).id);
  const filter = await searchParams;
  const findings = model.findings.filter(
    (item) =>
      (!filter.severity ||
        (filter.severity === "untriaged"
          ? !item.triage.severity
          : item.triage.severity === filter.severity)) &&
      (!filter.resolution || item.triage.resolution === filter.resolution) &&
      (!filter.outcome || item.check.outcome === filter.outcome),
  );
  const untriaged = model.findings.filter(
    (item) => !item.triage.severity,
  ).length;
  return (
    <>
      <Link href="/dashboard/reports">← Reports</Link>
      <div className="dashboard-title">
        <div>
          <p className="eyebrow">
            {model.report.kind === "diagnostic"
              ? "DIAGNOSTIC REPORT / INCOMPLETE COVERAGE"
              : "QA EVIDENCE REPORT"}
          </p>
          <h1>{model.report.project_name}</h1>
          <p className="project-url">{model.report.target_url}</p>
          <p>
            Scan status:{" "}
            <span className="scan-status" data-status={model.scan.status}>
              {model.scan.status.replace("_", " ")}
            </span>
          </p>
        </div>
        <PdfExport reportId={model.report.id} />
      </div>
      {model.report.kind === "diagnostic" && (
        <p className="form-error" role="status">
          This scan did not complete. Only persisted observations are included;
          missing checks are not passes.
        </p>
      )}
      <div className="report-summary">
        <div>
          <strong>{model.counts.pass}</strong>
          <span>Automated passes</span>
        </div>
        <div>
          <strong>{model.counts.fail}</strong>
          <span>Automated failures</span>
        </div>
        <div>
          <strong>{model.counts.warning}</strong>
          <span>Automated warnings</span>
        </div>
        <div>
          <strong>{untriaged}</strong>
          <span>Awaiting human severity</span>
        </div>
      </div>
      <section className="scan-panel">
        <h2>Scan context</h2>
        <dl className="report-context">
          <dt>Scan identifier</dt>
          <dd>
            <Link href={`/dashboard/scans/${model.scan.id}`}>
              {model.scan.id}
            </Link>
          </dd>
          <dt>Scan date</dt>
          <dd>{model.scan.created_at}</dd>
          <dt>Elapsed lifecycle</dt>
          <dd>
            {model.durationMs === null
              ? "Not recorded"
              : (model.durationMs / 1000).toFixed(1) + " seconds"}{" "}
            (can include retry waits)
          </dd>
          <dt>Report created</dt>
          <dd>{model.report.created_at}</dd>
          <dt>Authorization at request</dt>
          <dd>
            <AuthorizationSummary scan={model.scan} />
          </dd>
          <dt>Execution configuration</dt>
          <dd>
            <ConfigurationSummary scan={model.scan} />
          </dd>
        </dl>
      </section>
      <section className="scan-panel">
        <h2>Coverage and limitations</h2>
        <ul className="report-limitations">
          {model.limitations.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>
      <section className="scan-panel">
        <h2>Review findings</h2>
        <p>
          Severity is human triage, not an automated vulnerability rating.
          Changing status preserves the original observation.
        </p>
        <form className="finding-filters" method="get">
          <div className="field">
            <label htmlFor="filter-outcome">Automated outcome</label>
            <select
              name="outcome"
              id="filter-outcome"
              defaultValue={filter.outcome ?? ""}
            >
              <option value="">All outcomes</option>
              {["pass", "fail", "warning"].map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="filter-severity">Human severity</label>
            <select
              id="filter-severity"
              name="severity"
              defaultValue={filter.severity ?? ""}
            >
              <option value="">All severities</option>
              <option value="untriaged">Untriaged</option>
              {severities.map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="filter-resolution">Resolution</label>
            <select
              id="filter-resolution"
              name="resolution"
              defaultValue={filter.resolution ?? ""}
            >
              <option value="">All statuses</option>
              {resolutions.map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </div>
          <button className="button small">Apply filters</button>
          <Link href={`/dashboard/reports/${model.report.id}`}>Clear</Link>
        </form>
        <p className="field-hint">
          Showing {findings.length} of {model.findings.length} persisted
          observations.
        </p>
      </section>
      {findings.map((finding) => (
        <article className="scan-panel finding-panel" key={finding.check.id}>
          <div className="finding-heading">
            <div>
              <p className="eyebrow">{finding.check.check_type}</p>
              <h2>{finding.check.description}</h2>
            </div>
            <span className="scan-status" data-status={finding.check.outcome}>
              {finding.check.outcome}
            </span>
          </div>
          <p className="field-hint">
            Original automated observation ·{" "}
            {finding.check.duration_ms ?? "Unknown"} ms · {finding.check.id}
          </p>
          <p>
            <strong>Suggested review:</strong> {finding.guidance}
          </p>
          <details>
            <summary>Technical evidence</summary>
            <pre className="scan-details">
              {JSON.stringify(finding.check.details, null, 2)}
            </pre>
          </details>
          <FindingTriageForm
            key={finding.check.id + ":" + finding.triage.revision}
            triage={finding.triage}
            evidence={model.evidence}
            attached={finding.evidenceIds}
          />
          <p className="field-hint">
            Triage revision {finding.triage.revision} · Last updated{" "}
            {finding.triage.updated_at}
          </p>
          {finding.evidenceIds.length > 0 && (
            <p>
              Supporting evidence:{" "}
              {finding.evidenceIds.map((id) => (
                <Link
                  className="evidence-reference"
                  key={id}
                  href={"#evidence-" + id}
                >
                  {model.evidence.find((item) => item.checkId === id)?.type ??
                    "Screenshot"}{" "}
                  capture
                </Link>
              ))}
            </p>
          )}
          <section
            className="developer-comments"
            aria-label="Developer comments"
          >
            <h3>Developer comments</h3>
            {finding.comments.length ? (
              finding.comments.map((comment) => (
                <div className="developer-comment" key={comment.id}>
                  <p className="field-hint">
                    Project owner ·{" "}
                    <time dateTime={comment.created_at}>
                      {comment.created_at}
                    </time>
                  </p>
                  <p>{comment.body}</p>
                </div>
              ))
            ) : (
              <p className="field-hint">No comments yet.</p>
            )}
            <FindingCommentForm
              key={finding.check.id + ":" + finding.comments.length}
              reportId={model.report.id}
              checkId={finding.check.id}
            />
          </section>
        </article>
      ))}
      {!findings.length && (
        <p className="notice">
          {model.findings.length
            ? "No findings match these filters."
            : "No observations were persisted for this diagnostic scan."}
        </p>
      )}
      <section className="scan-panel">
        <h2>Screenshot evidence</h2>
        <p>
          These are original scan artifacts. Reports do not copy them or extend
          their retention.
        </p>
        {model.evidence.length ? (
          model.evidence.map((item) => (
            <figure
              className="report-evidence"
              id={"evidence-" + item.checkId}
              key={item.checkId}
            >
              <h3>{item.type} viewport</h3>
              {item.state === "available" ? (
                <Image
                  unoptimized
                  src={`/api/scans/${model.scan.id}/artifacts/${item.checkId}`}
                  width={item.type === "mobile" ? 390 : 1440}
                  height={item.type === "mobile" ? 844 : 900}
                  alt={`${item.type} screenshot captured by this scan`}
                  className="scan-screenshot"
                />
              ) : (
                <p className="notice">
                  Evidence {item.state}. No substitute image is shown.
                </p>
              )}
              <figcaption>
                Check {item.checkId} · Retention: {model.retentionDays} days
              </figcaption>
            </figure>
          ))
        ) : (
          <p>No screenshot artifacts were recorded.</p>
        )}
      </section>
    </>
  );
}
