import Link from "next/link";
import { loadReview } from "@/features/releases/queries";
import { ReviewContent } from "@/features/releases/components/review-content";
import {
  ManageReviewForm,
  InvitationLink,
} from "@/features/releases/components/forms";
import { getSiteOrigin } from "@/lib/supabase/config";
export const metadata = { title: "Release review history" };
export default async function OwnerRelease({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const data = await loadReview(id, true);
  const r = data.review;
  return (
    <>
      <Link href="/dashboard/releases">← Release reviews</Link>
      <ReviewContent {...data} owner />
      <section className="report-panel">
        <h2>Reviewer invitation</h2>
        <p>
          One primary reviewer per version. Share manually after submitting; no
          notification email is sent.
        </p>
        {data.invitations.map((i) => (
          <div key={i.id}>
            <p>
              {i.invited_email} ·{" "}
              {Date.parse(i.expires_at) <= data.now && i.status !== "revoked"
                ? "expired"
                : i.status}{" "}
              · expires {i.expires_at}
            </p>
            {["pending", "accepted"].includes(i.status) &&
              Date.parse(i.expires_at) > data.now && (
                <InvitationLink
                  url={`${getSiteOrigin()}/review-invitations/${i.id}`}
                />
              )}
          </div>
        ))}
        <ManageReviewForm review={r} now={data.now} />
        {["changes_requested", "approved", "revoked", "expired"].includes(
          r.status,
        ) && (
          <Link
            className="button secondary"
            href={`/dashboard/releases/new?previous=${r.id}`}
          >
            Prepare revised review version
          </Link>
        )}
        {r.previous_id && (
          <p>
            <Link href={`/dashboard/releases/${r.previous_id}`}>
              Previous review version
            </Link>
          </p>
        )}
      </section>
      <section className="report-panel">
        <h2>Audit timeline</h2>
        <p>
          Application audit history; this is not a legally qualified electronic
          signature.
        </p>
        <ol className="review-timeline">
          {data.events.map((e) => (
            <li key={e.id}>
              <strong>{e.event_type.replaceAll("_", " ")}</strong>
              <p>
                {e.created_at} · actor {e.actor_id ?? "Deleted account"}
              </p>
              <pre className="scan-details">
                {JSON.stringify(e.metadata, null, 2)}
              </pre>
            </li>
          ))}
        </ol>
      </section>
    </>
  );
}
