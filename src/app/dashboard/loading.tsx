export default function Loading() {
  return (
    <section className="empty-state" role="status" aria-live="polite">
      <h2>Loading your workspace…</h2>
      <p>Retrieving your saved projects.</p>
    </section>
  );
}
