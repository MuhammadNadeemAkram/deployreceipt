import Link from "next/link";
export default function NotFound() {
  return (
    <section className="empty-state">
      <h1>Project not found.</h1>
      <p>This project was removed or is not available to your account.</p>
      <Link className="button" href="/dashboard">
        Back to projects
      </Link>
    </section>
  );
}
