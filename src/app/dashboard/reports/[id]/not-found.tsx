import Link from "next/link";
export default function ReportNotFound() {
  return (
    <section className="empty-state">
      <h1>Report not found.</h1>
      <p>
        This report was removed with its project or is not available to your
        account.
      </p>
      <Link className="button" href="/dashboard/reports">
        Back to reports
      </Link>
    </section>
  );
}
