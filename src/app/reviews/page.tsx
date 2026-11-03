import Link from "next/link";
import { requireUser } from "@/features/auth/session";
export default async function ClientInvitations() {
  const { client, user } = await requireUser();
  await client.rpc("expire_release_reviews", {});
  const { data, error } = await client
    .from("review_invitations")
    .select("*")
    .eq("invited_email", user.email?.toLowerCase() ?? "")
    .in("status", ["pending", "accepted"])
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw new Error("Invitation services are unavailable.");
  return (
    <>
      <h1>Your client review invitations</h1>
      <p>
        Only your matching verified email can accept an invitation. These links
        do not provide access to other projects or report history.
      </p>
      {!data?.length && (
        <p>
          No current invitations. Verify your email and ask the developer for a
          current invitation link.
        </p>
      )}
      <ul className="report-list">
        {data?.map((i) => (
          <li key={i.id}>
            <div>
              <h2>
                {i.status === "accepted"
                  ? "Accepted review"
                  : "Pending invitation"}
              </h2>
              <p>Expires {i.expires_at}</p>
            </div>
            <Link
              href={
                i.status === "accepted"
                  ? `/reviews/${i.review_id}`
                  : `/review-invitations/${i.id}`
              }
            >
              Open invitation →
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
