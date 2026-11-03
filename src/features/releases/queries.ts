import "server-only";
import { notFound } from "next/navigation";
import { requireUser } from "@/features/auth/session";
import { isId } from "@/features/reports/model";
export async function loadReview(id: string, ownerOnly = false) {
  const { client, user } = await requireUser();
  if (!isId(id)) notFound();
  const expired = await client.rpc("expire_release_reviews", {});
  if (expired.error) throw new Error("Review services are unavailable.");
  const { data: review, error } = await client
    .from("release_reviews")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error("Review services are unavailable.");
  if (
    !review ||
    !user.email_confirmed_at ||
    (ownerOnly && review.owner_id !== user.id)
  )
    notFound();
  const [comments, decisions, evidence, events, invitations, settings] =
    await Promise.all([
      client
        .from("review_comments")
        .select("*")
        .eq("review_id", id)
        .order("created_at"),
      client.from("review_decisions").select("*").eq("review_id", id),
      client.from("release_review_evidence").select("*").eq("review_id", id),
      client.from("review_events").select("*").eq("review_id", id).order("id"),
      client
        .from("review_invitations")
        .select("*")
        .eq("review_id", id)
        .order("created_at", { ascending: false }),
      client.from("scan_settings").select("retention_days").single(),
    ]);
  if (
    [comments, decisions, evidence, events, invitations, settings].some(
      (r) => r.error,
    )
  )
    throw new Error("Review services are unavailable.");
  if (
    review.owner_id !== user.id &&
    (!["pending_review", "approved", "changes_requested"].includes(
      review.status,
    ) ||
      Date.parse(review.expires_at) <= Date.now() ||
      !invitations.data?.some(
        (i) =>
          i.status === "accepted" &&
          i.reviewer_user_id === user.id &&
          i.invited_email === user.email?.toLowerCase() &&
          Date.parse(i.expires_at) > Date.now(),
      ))
  )
    notFound();
  const effectiveEvidence = (evidence.data ?? []).map((e) => ({
    ...e,
    expires_at: new Date(
      Math.min(
        Date.parse(e.expires_at),
        Date.parse(review.snapshot.scan_date) +
          (settings.data?.retention_days ?? 0) * 86400000,
      ),
    ).toISOString(),
  }));
  return {
    now: Date.now(),
    client,
    user,
    review,
    comments: comments.data ?? [],
    decisions: decisions.data ?? [],
    evidence: effectiveEvidence,
    events: events.data ?? [],
    invitations: invitations.data ?? [],
  };
}
