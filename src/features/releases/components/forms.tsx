"use client";
import { useActionState, useState } from "react";
import type { FormState } from "@/features/auth/validation";
import {
  createRelease,
  manageRelease,
  acceptInvitation,
  postReviewComment,
  decideRelease,
  resolveFeedback,
} from "../actions";
import type { ReleaseReview, SnapshotFinding, ReviewComment } from "../types";
type Action = (state: FormState, form: FormData) => Promise<FormState>;
function ActionForm({
  action,
  children,
  label,
}: {
  action: Action;
  children: React.ReactNode;
  label: string;
}) {
  const [state, submit, pending] = useActionState(action, {} as FormState);
  return (
    <form action={submit} className="stack-form" aria-busy={pending}>
      {children}
      <div aria-live="polite">
        {state.error && (
          <p role="alert" className="form-error">
            {state.error}
          </p>
        )}
        {state.success && (
          <p role="status" className="form-success">
            {state.success}
          </p>
        )}
      </div>
      <button className="button small" disabled={pending}>
        {pending ? "Saving…" : label}
      </button>
    </form>
  );
}
export function CreateReleaseForm({
  reports,
  selected,
  previous,
}: {
  reports: { id: string; project_name: string; created_at: string }[];
  selected?: string;
  previous?: string;
}) {
  return (
    <ActionForm action={createRelease} label="Create immutable draft">
      <input type="hidden" name="previous" value={previous ?? ""} />
      <label>
        QA report
        <select name="report" defaultValue={selected} required>
          {reports.map((r) => (
            <option key={r.id} value={r.id}>
              {r.project_name} — {new Date(r.created_at).toISOString()} — {r.id}
            </option>
          ))}
        </select>
      </label>
      <label>
        Release name / version
        <input
          name="title"
          maxLength={120}
          required
          placeholder="e.g. Website release 1.2"
        />
      </label>
      <label>
        Release notes
        <textarea name="notes" rows={4} maxLength={4000} />
      </label>
      <label>
        Approved beta reviewer email
        <input
          type="email"
          name="email"
          maxLength={254}
          required
          autoComplete="email"
        />
      </label>
      <p className="field-hint">
        Creates a frozen report snapshot and a three-day invitation. Submission
        is a separate step. No email notification is sent. Changing findings
        later cannot change this review.
      </p>
    </ActionForm>
  );
}
export function ManageReviewForm({
  review,
  now,
}: {
  review: ReleaseReview;
  now: number;
}) {
  const expired = Date.parse(review.expires_at) <= now;
  const options = [
    ...(review.status === "draft" && !expired
      ? [{ value: "submit", label: "Submit for client review" }]
      : []),
    ...(!["revoked", "expired"].includes(review.status)
      ? [{ value: "revoke", label: "Revoke review and invitation" }]
      : []),
    ...((review.status === "expired" || expired) &&
    !review.completed_at &&
    review.status !== "revoked"
      ? [{ value: "reissue", label: "Reissue expired invitation (three days)" }]
      : []),
  ];
  return options.length ? (
    <ActionForm
      action={manageRelease.bind(null, review.id)}
      label="Apply review action"
    >
      <label>
        Review action
        <select name="action">
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      <p className="field-hint">
        Revocation removes reviewer access, including an accepted invitation.
        Previous decisions remain in history.
      </p>
    </ActionForm>
  ) : null;
}
export function AcceptInvitationForm({ id }: { id: string }) {
  return (
    <ActionForm
      action={acceptInvitation.bind(null, id)}
      label="Accept invitation and open review"
    >
      <p>
        You must be signed in with the matching verified email. The invitation
        link alone grants no access.
      </p>
    </ActionForm>
  );
}
export function InvitationLink({ url }: { url: string }) {
  const [notice, setNotice] = useState("");
  return (
    <div className="stack-form">
      <label>
        Manual invitation link
        <input readOnly value={url} onFocus={(e) => e.currentTarget.select()} />
      </label>
      <button
        className="button secondary small"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(url);
            setNotice(
              "Invitation link copied. Send it to the named reviewer; no email was sent by DeployReceipt.",
            );
          } catch {
            setNotice("Select and copy the invitation link above.");
          }
        }}
      >
        Copy invitation link
      </button>
      <p role="status">{notice}</p>
    </div>
  );
}
export function ReviewCommentForm({
  review,
  comments,
}: {
  review: ReleaseReview;
  comments: ReviewComment[];
}) {
  return (
    <ActionForm
      action={postReviewComment.bind(null, review.id)}
      label="Record feedback / reply"
    >
      <label>
        Feedback
        <textarea name="content" maxLength={2000} rows={3} required />
      </label>
      <label>
        Related finding
        <select name="finding">
          <option value="">General release feedback</option>
          {review.snapshot.findings.map((f) => (
            <option key={f.id} value={f.id}>
              {f.type}: {f.description}
            </option>
          ))}
        </select>
      </label>
      <label>
        Reply to
        <select name="parent">
          <option value="">New thread</option>
          {comments.map((c) => (
            <option key={c.id} value={c.id}>
              {c.author_role}: {c.content.slice(0, 70)}
            </option>
          ))}
        </select>
      </label>
      <label>
        Feedback type
        <select name="kind">
          <option value="comment">Comment</option>
          <option value="change_request">Specific change requested</option>
        </select>
      </label>
      <p className="field-hint">
        Plain text, up to 2,000 characters. Feedback is append-only, with a
        limit of 100 comments per review. A comment does not submit a release
        decision.
      </p>
    </ActionForm>
  );
}
export function ResolveFeedbackForm({
  reviewId,
  comment,
}: {
  reviewId: string;
  comment: ReviewComment;
}) {
  return (
    <ActionForm
      action={resolveFeedback.bind(null, reviewId)}
      label={comment.resolved_at ? "Reopen feedback" : "Mark feedback resolved"}
    >
      <input type="hidden" name="comment" value={comment.id} />
      <input
        type="hidden"
        name="resolved"
        value={comment.resolved_at ? "false" : "true"}
      />
    </ActionForm>
  );
}
export function DecisionForm({ review }: { review: ReleaseReview }) {
  return (
    <ActionForm
      action={decideRelease.bind(null, review.id)}
      label="Record final decision for this version"
    >
      <input name="version" type="hidden" value={review.version} />
      <input name="digest" type="hidden" value={review.snapshot_digest} />
      <p>
        Review version {review.version} and its evidence above before deciding.
        Approval accepts this release version; it does not mean every test
        passed, security certification was obtained, or deployment occurred.
      </p>
      <label htmlFor={review.id + "-decision"}>Decision</label>
      <select id={review.id + "-decision"} name="decision">
        <option value="changes_requested">Request changes</option>
        <option value="approved">Approve release</option>
      </select>
      <label>
        Decision notes (required for changes requested)
        <textarea name="notes" maxLength={2000} rows={4} />
      </label>
      <fieldset>
        <legend>Required acknowledgements for approval</legend>
        <label className="review-check">
          <input type="checkbox" name="scope_ack" /> I reviewed this exact
          version and understand the approval scope.
        </label>
        <label className="review-check">
          <input type="checkbox" name="observations_ack" /> I explicitly
          acknowledge the {review.snapshot.failed} failed checks and{" "}
          {review.snapshot.warnings} warnings.
        </label>
        <label className="review-check">
          <input type="checkbox" name="evidence_ack" /> I reviewed the available
          evidence and acknowledge any missing or expired screenshots and
          coverage limitations.
        </label>
      </fieldset>
      <p className="field-hint">
        Decisions are permanent for this version. A revised release requires a
        new review and explicit decision.
      </p>
    </ActionForm>
  );
}
export function FindingOptions({ findings }: { findings: SnapshotFinding[] }) {
  return findings.map((f) => (
    <option key={f.id} value={f.id}>
      {f.type}
    </option>
  ));
}
