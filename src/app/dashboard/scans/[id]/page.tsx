import Link from "next/link";
import Image from "next/image";
import { ownedScan } from "@/features/scans/queries";
import { StatusRefresh } from "@/features/scans/components/status-refresh";
import { CreateReport } from "@/features/reports/components/create-report";
export const metadata = { title: "Scan findings" };
export default async function ScanDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { client, run, project } = await ownedScan((await params).id);
  const { data: checks, error } = await client
    .from("scan_checks")
    .select("*")
    .eq("scan_run_id", run.id)
    .order("check_type");
  if (error) throw new Error("Unable to load findings.");
  return (
    <>
      <Link href={`/dashboard/projects/${project.id}`}>← {project.name}</Link>
      <div className="dashboard-title">
        <div>
          <p className="eyebrow">QA SCAN</p>
          <h1>Scan findings</h1>
          <p>
            <span className="scan-status" data-status={run.status}>
              {run.status.replace("_", " ")}
            </span>{" "}
            · Attempt {run.attempts}
          </p>
        </div>
      </div>
      <section className="scan-panel">
        <p>Requested {new Date(run.created_at).toISOString()}</p>
        {run.configuration_snapshot?.mode === "public" && (
          <p className="notice">
            Authorized public staging scan · exact verified origin · GET/HEAD
            only. Blocked resources are coverage limitations; unexecuted checks
            are recorded as warnings.
          </p>
        )}
        {run.completed_at && (
          <p>Finished {new Date(run.completed_at).toISOString()}</p>
        )}
        {run.status === "queued" && (
          <p>
            Waiting for an available worker. This request does not run a browser
            in the web server.
          </p>
        )}
        {run.status === "running" && (
          <p>
            A worker is processing this scan. Expired leases are recovered
            automatically when a worker resumes.
          </p>
        )}
        {run.error_message && (
          <p className="form-error">
            {run.error_message} ({run.error_code})
          </p>
        )}
        <StatusRefresh active={["queued", "running"].includes(run.status)} />
        <div className="scan-counts">
          <span>{run.passed_count} passed</span>
          <span>{run.failed_count} failed</span>
          <span>{run.warning_count} warnings</span>
        </div>
        <p className="field-hint">
          Counts reflect persisted checks only. A captured screenshot does not
          establish visual correctness or accessibility compliance.
        </p>
      </section>
      {["completed", "failed", "timed_out"].includes(run.status) && (
        <section className="scan-panel">
          <h2>QA report</h2>
          <p>
            Review these persisted observations, add human triage, and export
            private evidence.
          </p>
          <CreateReport
            scanId={run.id}
            diagnostic={run.status !== "completed"}
          />
        </section>
      )}
      {checks?.length ? (
        checks.map((check) => (
          <section className="scan-panel" key={check.id}>
            <h2>
              {check.check_type.charAt(0).toUpperCase() +
                check.check_type.slice(1)}{" "}
              <span className="scan-status" data-status={check.outcome}>
                {check.outcome}
              </span>
            </h2>
            <p>{check.description}</p>
            {check.duration_ms !== null && (
              <p className="field-hint">{check.duration_ms} ms</p>
            )}
            <details>
              <summary>Technical observations</summary>
              <pre className="scan-details">
                {JSON.stringify(check.details, null, 2)}
              </pre>
            </details>
            {check.screenshot_path && (
              <figure>
                <Image
                  unoptimized
                  src={`/api/scans/${run.id}/artifacts/${check.id}`}
                  width={check.check_type === "mobile" ? 390 : 1440}
                  height={check.check_type === "mobile" ? 844 : 900}
                  alt={`${check.check_type} viewport captured during this scan`}
                  className="scan-screenshot"
                />
                <figcaption>
                  Private, short-lived access. Artifacts may be unavailable
                  after the configured retention period.
                </figcaption>
              </figure>
            )}
          </section>
        ))
      ) : (
        <p className="notice">No findings have been persisted yet.</p>
      )}
    </>
  );
}
