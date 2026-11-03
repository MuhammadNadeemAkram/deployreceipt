import Link from "next/link";
import { requireUser } from "@/features/auth/session";
import { reviewStatuses } from "@/features/releases/validation";
export const metadata = { title: "Release reviews" };
export default async function ReleaseReviews({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { client, user } = await requireUser();
  await client.rpc("expire_release_reviews", {});
  const { status } = await searchParams;
  let query = client
    .from("release_reviews")
    .select("*")
    .eq("owner_id", user.id)
    .order("created_at", { ascending: false })
    .limit(50);
  if (reviewStatuses.includes(status as (typeof reviewStatuses)[number]))
    query = query.eq("status", status as (typeof reviewStatuses)[number]);
  const { data, error } = await query;
  if (error) throw new Error("Review services are unavailable.");
  return (
    <>
      <div className="dashboard-title">
        <div>
          <p className="eyebrow">RELEASE REVIEWS</p>
          <h1>Share a specific version.</h1>
          <p>Client feedback and decisions bound to immutable QA evidence.</p>
        </div>
        <Link className="button" href="/dashboard/releases/new">
          Create release review
        </Link>
      </div>
      <form className="report-filters">
        <label>
          Status
          <select name="status" defaultValue={status ?? ""}>
            <option value="">All statuses</option>
            {reviewStatuses.map((s) => (
              <option key={s} value={s}>
                {s.replaceAll("_", " ")}
              </option>
            ))}
          </select>
        </label>
        <button className="button small">Apply filter</button>
      </form>
      <p>
        Latest 50 matching reviews. No approval is carried forward to a new
        version.
      </p>
      <ul className="report-list">
        {data?.map((r) => (
          <li key={r.id}>
            <div>
              <h2>
                <Link href={`/dashboard/releases/${r.id}`}>{r.title}</Link>
              </h2>
              <p>
                {r.snapshot.project_name} · version {r.version}
              </p>
              <p>
                {r.status.replaceAll("_", " ")} · {r.created_at}
              </p>
            </div>
            <Link href={`/dashboard/releases/${r.id}`}>
              Review and history →
            </Link>
          </li>
        ))}
      </ul>
      {!data?.length && (
        <p>
          No release reviews match this filter. Create one from a completed QA
          report.
        </p>
      )}
    </>
  );
}
