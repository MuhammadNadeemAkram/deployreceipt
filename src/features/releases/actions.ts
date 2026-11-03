"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/features/auth/session";
import type { FormState } from "@/features/auth/validation";
import { isId } from "@/features/reports/model";
import { reviewInput, commentInput, decisionInput } from "./validation";
const errorMessage =
  "Unable to complete this request. Check your account, review version, invitation and expiry, then refresh. No decision is carried to another version.";
export async function createRelease(
  _state: FormState,
  form: FormData,
): Promise<FormState> {
  void _state;
  const input = reviewInput(form);
  if (!input)
    return {
      error:
        "Enter a report, release name (up to 120 characters), reviewer email and notes (up to 4,000 characters).",
    };
  const { client } = await requireUser();
  const { data, error } = await client.rpc("create_release_review", {
    p_report: input.report,
    p_title: input.title,
    p_notes: input.notes,
    p_email: input.email,
    p_previous: input.previous,
  });
  if (error || !data) return { error: errorMessage };
  redirect(`/dashboard/releases/${data}`);
}
export async function manageRelease(
  id: string,
  _state: FormState,
  form: FormData,
): Promise<FormState> {
  void _state;
  const action = String(form.get("action"));
  if (!isId(id) || !["submit", "revoke", "reissue"].includes(action))
    return { error: errorMessage };
  const { client } = await requireUser();
  const { error } = await client.rpc("manage_release_review", {
    p_id: id,
    p_action: action,
  });
  if (error) return { error: errorMessage };
  revalidatePath(`/dashboard/releases/${id}`);
  revalidatePath("/reviews");
  return {
    success:
      "Review updated. No notification email was sent; copy the invitation link to share it securely.",
  };
}
export async function acceptInvitation(
  id: string,
  _state: FormState,
): Promise<FormState> {
  void _state;
  if (!isId(id)) return { error: errorMessage };
  const { client } = await requireUser();
  const { data, error } = await client.rpc("accept_review_invitation", {
    p_invitation: id,
  });
  if (error || !data)
    return {
      error:
        "This invitation is unavailable. Sign in with the matching verified email, or ask the developer for a current invitation.",
    };
  redirect(`/reviews/${data}`);
}
export async function postReviewComment(
  id: string,
  _state: FormState,
  form: FormData,
): Promise<FormState> {
  void _state;
  const input = commentInput(form);
  if (!isId(id) || !input)
    return {
      error:
        "Enter plain-text feedback up to 2,000 characters and a listed finding or reply.",
    };
  const { client } = await requireUser();
  const { error } = await client.rpc("add_review_comment", {
    p_id: id,
    p_content: input.content,
    p_finding: input.finding,
    p_parent: input.parent,
    p_kind: input.kind,
  });
  if (error) return { error: errorMessage };
  revalidatePath(`/reviews/${id}`);
  revalidatePath(`/dashboard/releases/${id}`);
  return { success: "Feedback recorded. The original text is preserved." };
}
export async function resolveFeedback(
  id: string,
  _state: FormState,
  form: FormData,
): Promise<FormState> {
  void _state;
  const cid = String(form.get("comment")),
    resolved = form.get("resolved");
  if (!isId(id) || !isId(cid) || !["true", "false"].includes(String(resolved)))
    return { error: errorMessage };
  const { client } = await requireUser();
  const { error } = await client.rpc("resolve_review_feedback", {
    p_id: id,
    p_comment: cid,
    p_resolved: resolved === "true",
  });
  if (error) return { error: errorMessage };
  revalidatePath(`/dashboard/releases/${id}`);
  return { success: "Feedback resolution recorded in the audit timeline." };
}
export async function decideRelease(
  id: string,
  _state: FormState,
  form: FormData,
): Promise<FormState> {
  void _state;
  const input = decisionInput(form);
  if (!isId(id) || !input)
    return {
      error:
        "Check the review version, acknowledgements and decision notes. Changes requested require feedback.",
    };
  const { client } = await requireUser();
  const { error } = await client.rpc("decide_release_review", {
    p_id: id,
    p_version: input.version,
    p_digest: input.digest,
    p_decision: input.decision,
    p_scope_ack: input.scope,
    p_observations_ack: input.observations,
    p_evidence_ack: input.evidence,
    p_notes: input.notes,
  });
  if (error) return { error: errorMessage };
  revalidatePath(`/reviews/${id}`);
  return {
    success:
      "Your decision is recorded for this exact version. It does not imply deployment or certification.",
  };
}
