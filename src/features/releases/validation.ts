import { isId } from "@/features/reports/model";
export const reviewStatuses = [
  "draft",
  "pending_review",
  "changes_requested",
  "approved",
  "revoked",
  "expired",
] as const;
export function reviewInput(form: FormData) {
  const report = String(form.get("report") ?? ""),
    title = String(form.get("title") ?? "").trim(),
    notes = String(form.get("notes") ?? ""),
    email = String(form.get("email") ?? "")
      .trim()
      .toLowerCase(),
    previous = String(form.get("previous") ?? "");
  if (
    !isId(report) ||
    !title ||
    title.length > 120 ||
    notes.length > 4000 ||
    email.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
    (previous && !isId(previous)) ||
    hasControls(title + notes + email)
  )
    return null;
  return { report, title, notes, email, previous: previous || null };
}
export function hasControls(value: string) {
  return /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value);
}
export function commentInput(form: FormData) {
  const content = String(form.get("content") ?? "").trim(),
    finding = String(form.get("finding") ?? ""),
    parent = String(form.get("parent") ?? ""),
    kind = String(form.get("kind") ?? "comment");
  if (
    !content ||
    content.length > 2000 ||
    hasControls(content) ||
    (finding && !isId(finding)) ||
    (parent && !isId(parent)) ||
    !["comment", "change_request"].includes(kind)
  )
    return null;
  return { content, finding: finding || null, parent: parent || null, kind };
}
export function decisionInput(form: FormData) {
  const decision = String(form.get("decision") ?? ""),
    digest = String(form.get("digest") ?? ""),
    version = Number(form.get("version")),
    notes = String(form.get("notes") ?? "").trim();
  const scope = form.get("scope_ack") === "on",
    observations = form.get("observations_ack") === "on",
    evidence = form.get("evidence_ack") === "on";
  if (
    !["approved", "changes_requested"].includes(decision) ||
    !/^[a-f0-9]{64}$/.test(digest) ||
    !Number.isSafeInteger(version) ||
    version < 1 ||
    notes.length > 2000 ||
    hasControls(notes) ||
    (decision === "changes_requested" && !notes) ||
    (decision === "approved" && (!scope || !observations || !evidence))
  )
    return null;
  return { decision, digest, version, notes, scope, observations, evidence };
}
