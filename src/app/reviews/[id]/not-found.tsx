import Link from "next/link";
export default function ReviewNotFound() {
  return (
    <section className="report-panel">
      <h1>Review unavailable</h1>
      <p>
        This review may have expired, been revoked or deleted, or require a
        different verified account. Ask the developer for a current invitation.
      </p>
      <Link href="/reviews">Return to your invitations</Link>
    </section>
  );
}
