import Link from "next/link";
import { requireUser } from "@/features/auth/session";
export const metadata = { title: "QA reports" };
export default async function Reports() {
  const { client } = await requireUser();
  const { data: reports, error } = await client
    .from("qa_reports")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(50);
  if (error)
    throw new Error("Unable to load reports. Check the reporting migration.");
  const { data: runs, error: runError } = reports?.length
    ? await client
        .from("scan_runs")
        .select("id,failed_count,warning_count,status")
        .in(
          "id",
          reports.map((report) => report.scan_run_id),
        )
    : { data: [], error: null };
  if (runError) throw new Error("Unable to load report observations.");
  const failed = runs?.reduce((total, run) => total + run.failed_count, 0) ?? 0;
  return (
    <>
      <div className="dashboard-title">
        <div>
          <p className="eyebrow">QA REPORTS</p>
          <h1>Evidence you can act on.</h1>
          <p>
            Observed results, human triage, and private supporting evidence.
          </p>
        </div>
        <Link className="button secondary" href="/dashboard">
          View projects
        </Link>
      </div>
      <div className="report-summary">
        <div>
          <strong>{reports?.length ?? 0}</strong>
          <span>Recent reports shown</span>
        </div>
        <div>
          <strong>{failed}</strong>
          <span>Failed checks in shown reports</span>
        </div>
        <div>
          <strong>
            {reports?.filter((report) => report.kind === "diagnostic").length ??
              0}
          </strong>
          <span>Incomplete diagnostic reports</span>
        </div>
      </div>
      {!reports?.length ? (
        <section className="empty-state">
          <h2>No reports yet.</h2>
          <p>
            Open a finished scan to create a QA report. Failed or timed-out
            scans can produce clearly labeled diagnostic reports.
          </p>
          <Link className="button" href="/dashboard">
            Choose a project
          </Link>
        </section>
      ) : (
        <>
          <p className="field-hint">
            Latest 50 reports. Counts describe these reports, not unique issues
            across releases.
          </p>
          <ul className="report-list">
            {reports.map((report) => {
              const run = runs?.find((item) => item.id === report.scan_run_id);
              return (
                <li key={report.id}>
                  <div>
                    <p className="eyebrow">
                      {report.kind === "diagnostic"
                        ? "DIAGNOSTIC / INCOMPLETE"
                        : "QA EVIDENCE REPORT"}
                    </p>
                    <h2>
                      <Link href={`/dashboard/reports/${report.id}`}>
                        {report.project_name}
                      </Link>
                    </h2>
                    <p className="project-url">{report.target_url}</p>
                    <p className="field-hint">
                      Created {new Date(report.created_at).toISOString()}
                    </p>
                  </div>
                  <div>
                    <span className="scan-status" data-status={run?.status}>
                      {run?.status?.replace("_", " ") ?? "Unavailable"}
                    </span>
                    <p>
                      {run?.failed_count ?? 0} failed ·{" "}
                      {run?.warning_count ?? 0} warnings
                    </p>
                    <Link
                      className="report-open"
                      href={`/dashboard/reports/${report.id}`}
                    >
                      Open report →
                    </Link>
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </>
  );
}
