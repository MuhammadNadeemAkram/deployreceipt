import type {
  ReportRecord,
  ReportModel,
  Triage,
  Comment,
  EvidenceLink,
  EvidenceState,
  Severity,
  Resolution,
} from "./types";
import type { ScanRun, ScanCheck } from "@/features/scans/types";
const guidance: Record<ScanCheck["check_type"], string> = {
  availability:
    "Inspect the observed HTTP status, DNS/TLS category, and final URL. Re-run after fixing the underlying response.",
  desktop:
    "Inspect the captured viewport or navigation error. A successful capture does not establish visual correctness.",
  mobile:
    "Inspect the mobile viewport at its recorded dimensions and reproduce any navigation/capture failure.",
  javascript:
    "Reproduce the console/page errors and separate first-party failures from blocked third-party resources before prioritizing.",
  links:
    "Review each checked URL and its response or redirect category. Fix broken internal targets; this is not an exhaustive crawl.",
  network:
    "Review failed and policy-blocked resources in context. A blocked request is not automatically a website defect or vulnerability.",
};
export const severities: Severity[] = ["critical", "high", "medium", "low"];
export const resolutions: Resolution[] = [
  "open",
  "investigating",
  "resolved",
  "ignored",
];
export function buildReport(input: {
  report: ReportRecord;
  scan: ScanRun;
  checks: ScanCheck[];
  triage: Triage[];
  comments: Comment[];
  links: EvidenceLink[];
  retentionDays: number;
  now?: Date;
}): ReportModel {
  const { report, scan, checks, triage, comments, links, retentionDays } =
    input;
  const now = input.now ?? new Date();
  if (
    report.scan_run_id !== scan.id ||
    report.project_id !== scan.project_id ||
    !["completed", "failed", "timed_out"].includes(scan.status)
  )
    throw new Error("report_data_inconsistent");
  if (
    checks.length > 6 ||
    comments.length > 30 ||
    checks.some((check) => check.scan_run_id !== scan.id)
  )
    throw new Error("report_data_inconsistent");
  const counts = { pass: 0, fail: 0, warning: 0 };
  checks.forEach((check) => counts[check.outcome]++);
  if (
    scan.status === "completed" &&
    (checks.length !== 6 ||
      counts.pass !== scan.passed_count ||
      counts.fail !== scan.failed_count ||
      counts.warning !== scan.warning_count ||
      report.kind !== "qa")
  )
    throw new Error("report_data_inconsistent");
  if (scan.status !== "completed" && report.kind !== "diagnostic")
    throw new Error("report_data_inconsistent");
  const expired =
    Date.parse(scan.created_at) + retentionDays * 86400000 <= now.getTime();
  const evidence: EvidenceState[] = checks
    .filter((check) => check.screenshot_path)
    .map((check) => ({
      checkId: check.id,
      type: check.check_type,
      path: check.screenshot_path,
      state: expired ? "expired" : "available",
    }));
  const publicCoverage = scan.configuration_snapshot?.mode === "public";
  const blocked = checks.reduce(
    (sum, check) =>
      sum +
      (typeof check.details.policy_blocked === "number"
        ? check.details.policy_blocked
        : 0),
    0,
  );
  const notExecuted = checks
    .filter((check) => check.details.executed === false)
    .map((check) => check.check_type);
  const limitations = [
    ...(publicCoverage
      ? [
          "Authorized public scan: exact verified origin, unauthenticated GET/HEAD only, controller-mediated pinned gateway, third-party resources blocked. This is not guaranteed side-effect-free.",
          `Policy-blocked requests: ${blocked}. Checks not executed: ${notExecuted.join(", ") || "none recorded"}. Blocked observations are warnings, not confirmed website defects.`,
        ]
      : []),
    "This report records observed checks; it is not a security certification, accessibility audit, visual-regression verdict, or release approval.",
    "Scope is one target, two viewports, and at most five eligible internal links. Third-party requests may be blocked by policy.",
    "Severity and resolution are human triage. Manual changes do not alter the automated outcomes.",
    `Screenshot retention is ${retentionDays} days under the current installation policy. Missing or expired evidence is not reconstructed.`,
  ];
  if (!scan.configuration_snapshot)
    limitations.push(
      "Historical execution configuration was not recorded for this scan; current settings are not substituted.",
    );
  if (!scan.verification_snapshot)
    limitations.push(
      "Historical authorization evidence was not recorded. The URL shown is the stored scan target, not a new verification claim.",
    );
  if (report.kind === "diagnostic")
    limitations.unshift(
      `INCOMPLETE COVERAGE: the scan ended as ${scan.status}; only persisted observations are included.`,
    );
  return {
    report,
    scan,
    counts,
    retentionDays,
    evidence,
    limitations,
    durationMs:
      scan.started_at && scan.completed_at
        ? Math.max(
            0,
            Date.parse(scan.completed_at) - Date.parse(scan.started_at),
          )
        : null,
    findings: checks.map((check) => {
      const manual = triage.find(
        (item) =>
          item.report_id === report.id &&
          item.scan_check_id === check.id &&
          item.scan_run_id === scan.id,
      );
      if (!manual) throw new Error("report_data_inconsistent");
      return {
        check,
        triage: manual,
        guidance:
          check.outcome === "pass"
            ? "No problem was observed within this bounded check. Continue manual review where coverage is limited."
            : guidance[check.check_type],
        comments: comments.filter(
          (comment) =>
            comment.report_id === report.id &&
            comment.scan_check_id === check.id,
        ),
        evidenceIds: links
          .filter(
            (link) =>
              link.report_id === report.id &&
              link.finding_check_id === check.id &&
              link.scan_run_id === scan.id,
          )
          .map((link) => link.evidence_check_id),
      };
    }),
  };
}
export function validateTriage(form: FormData) {
  const severity = String(form.get("severity") ?? "");
  const resolution = String(form.get("resolution") ?? "");
  const notes = form.get("notes");
  const revision = Number(form.get("revision"));
  const evidenceIds = form
    .getAll("evidence")
    .map((value) => (typeof value === "string" ? value : ""));
  const errors: Record<string, string> = {};
  if (severity && !severities.includes(severity as Severity))
    errors.severity = "Choose a listed severity.";
  if (!resolutions.includes(resolution as Resolution))
    errors.resolution = "Choose a listed status.";
  if (
    typeof notes !== "string" ||
    notes.length > 2000 ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(notes)
  )
    errors.notes = "Use plain text, up to 2,000 characters.";
  if (!Number.isSafeInteger(revision) || revision < 1)
    errors.revision = "Refresh this report before saving.";
  if (evidenceIds.length > 2 || evidenceIds.some((id) => !isId(id)))
    errors.evidence = "Choose at most two screenshots from this scan.";
  return {
    errors,
    severity: severity || null,
    resolution,
    notes: typeof notes === "string" ? notes : "",
    revision,
    evidenceIds: [...new Set(evidenceIds)],
  };
}
export function isId(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    value,
  );
}
