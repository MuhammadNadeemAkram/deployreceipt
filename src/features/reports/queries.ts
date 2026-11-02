import "server-only";
import { notFound } from "next/navigation";
import { requireUser } from "@/features/auth/session";
import { buildReport, isId } from "./model";
export async function ownedReport(id: string) {
  const { client, user } = await requireUser();
  if (!isId(id)) notFound();
  const { data: report, error } = await client
    .from("qa_reports")
    .select("*")
    .eq("id", id)
    .abortSignal(AbortSignal.timeout(10000))
    .maybeSingle();
  if (error) throw new Error("Report services are unavailable.");
  if (!report) notFound();
  const { data: project } = await client
    .from("projects")
    .select("id")
    .eq("id", report.project_id)
    .eq("owner_id", user.id)
    .maybeSingle();
  if (!project) notFound();
  const [run, checks, triage, comments, links, settings] = await Promise.all([
    client.from("scan_runs").select("*").eq("id", report.scan_run_id).single(),
    client
      .from("scan_checks")
      .select("*")
      .eq("scan_run_id", report.scan_run_id)
      .order("check_type"),
    client.from("qa_finding_triage").select("*").eq("report_id", id),
    client
      .from("qa_comments")
      .select("*")
      .eq("report_id", id)
      .order("created_at"),
    client.from("qa_finding_evidence").select("*").eq("report_id", id),
    client.from("scan_settings").select("retention_days").single(),
  ]);
  if (
    [run, checks, triage, comments, links, settings].some(
      (result) => result.error,
    ) ||
    !run.data ||
    !settings.data
  )
    throw new Error("Report services are unavailable.");
  const model = buildReport({
    report,
    scan: run.data,
    checks: checks.data ?? [],
    triage: triage.data ?? [],
    comments: comments.data ?? [],
    links: links.data ?? [],
    retentionDays: settings.data.retention_days,
  });
  // Validate availability with the user's private Storage authorization; do not persist signed URLs.
  await Promise.all(
    model.evidence.map(async (item) => {
      if (item.state !== "available" || !item.path) return;
      try {
        const { error } = await client.storage
          .from("scan-artifacts")
          .createSignedUrl(item.path, 60);
        if (error) item.state = "unavailable";
      } catch {
        item.state = "unavailable";
      }
    }),
  );
  return { client, user, model };
}
