"use client";
import Link from "next/link";
export default function DashboardError({ reset }: { reset: () => void }) {
  return (
    <section className="empty-state" role="alert">
      <h2>Your workspace could not be loaded.</h2>
      <p>
        Check your connection and try again. If this continues, check the
        Supabase configuration and migration.
      </p>
      <div className="actions">
        <button className="button" onClick={reset}>
          Try again
        </button>
        <Link className="button secondary" href="/login">
          Sign in again
        </Link>
      </div>
    </section>
  );
}
