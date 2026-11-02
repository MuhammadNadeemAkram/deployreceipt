"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/features/auth/session";
import { isId, validateTriage } from "./model";
import type { FormState } from "@/features/auth/validation";
const messages: Record<string, string> = {
  scan_not_terminal: "Wait until the scan finishes before creating a report.",
  scan_data_inconsistent:
    "The persisted scan data is inconsistent. No report was created.",
  stale_triage:
    "This finding changed in another session. Refresh before saving.",
  invalid_evidence: "Evidence must be a screenshot from this scan.",
  evidence_unavailable:
    "That screenshot is missing or expired. Remove the new attachment and try again.",
  comment_limit: "This report has reached its 30-comment limit.",
};
export async function createReport(
  scanId: string,
  state: FormState,
): Promise<FormState> {
  void state;
  const { client } = await requireUser();
  if (!isId(scanId)) return { error: "Scan not found." };
  let id: string | null = null;
  try {
    const { data, error } = await client.rpc("create_qa_report", {
      p_scan_id: scanId,
    });
    if (error)
      return {
        error:
          messages[error.message] ?? "Unable to create a report for this scan.",
      };
    id = data;
  } catch {
    return { error: "Report services are unavailable." };
  }
  if (id) {
    revalidatePath("/dashboard/reports");
    redirect(`/dashboard/reports/${id}`);
  }
  return { error: "Unable to create report." };
}
export async function saveTriage(
  reportId: string,
  checkId: string,
  state: FormState,
  form: FormData,
): Promise<FormState> {
  void state;
  const { client } = await requireUser();
  if (!isId(reportId) || !isId(checkId)) return { error: "Finding not found." };
  const input = validateTriage(form);
  if (Object.keys(input.errors).length)
    return { error: "Check the finding fields.", fieldErrors: input.errors };
  try {
    const { error } = await client.rpc("save_qa_triage", {
      p_report_id: reportId,
      p_check_id: checkId,
      p_severity: input.severity,
      p_resolution: input.resolution,
      p_notes: input.notes,
      p_revision: input.revision,
      p_evidence: input.evidenceIds,
    });
    if (error)
      return {
        error: messages[error.message] ?? "Unable to save this finding.",
      };
  } catch {
    return { error: "Report services are unavailable." };
  }
  revalidatePath(`/dashboard/reports/${reportId}`);
  return { success: "Triage saved. The automated outcome is unchanged." };
}
export async function addComment(
  reportId: string,
  checkId: string,
  state: FormState,
  form: FormData,
): Promise<FormState> {
  void state;
  const { client } = await requireUser();
  const value = form.get("comment");
  const body = typeof value === "string" ? value.trim() : "";
  if (
    !isId(reportId) ||
    !isId(checkId) ||
    !body ||
    body.length > 2000 ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(body)
  )
    return {
      error: "Enter a plain-text comment between 1 and 2,000 characters.",
    };
  try {
    const { error } = await client.rpc("add_qa_comment", {
      p_report_id: reportId,
      p_check_id: checkId,
      p_body: body,
    });
    if (error)
      return { error: messages[error.message] ?? "Unable to add a comment." };
  } catch {
    return { error: "Report services are unavailable." };
  }
  revalidatePath(`/dashboard/reports/${reportId}`);
  return { success: "Comment added." };
}
