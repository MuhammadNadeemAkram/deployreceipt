import { requireUser } from "@/features/auth/session";
import { loadReview } from "@/features/releases/queries";
import { CreateReleaseForm } from "@/features/releases/components/forms";
export const metadata = { title: "Create release review" };
export default async function NewRelease({
  searchParams,
}: {
  searchParams: Promise<{ report?: string; previous?: string }>;
}) {
  const { report, previous } = await searchParams;
  const { client } = await requireUser();
  const prior = previous ? (await loadReview(previous, true)).review : null;
  let query = client
    .from("qa_reports")
    .select("id,project_name,created_at")
    .eq("kind", "qa")
    .order("created_at", { ascending: false })
    .limit(100);
  if (prior) query = query.eq("project_id", prior.project_id);
  const { data, error } = await query;
  if (error) throw new Error("Reports unavailable.");
  return (
    <section className="report-panel">
      <p className="eyebrow">
        {prior
          ? `REVISED REVIEW AFTER VERSION ${prior.version}`
          : "NEW RELEASE REVIEW"}
      </p>
      <h1>Create a frozen review version.</h1>
      <p>
        Select a completed QA report. Draft content is immutable; if it needs
        changes, revoke it and create a revised version. Diagnostic reports are
        not eligible.
      </p>
      {data?.length ? (
        <CreateReleaseForm
          reports={data}
          selected={report ?? prior?.report_id}
          previous={prior?.id}
        />
      ) : (
        <p>
          No eligible reports. Complete a controlled scan and create its QA
          report first.
        </p>
      )}
    </section>
  );
}
