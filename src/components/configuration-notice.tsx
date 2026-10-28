export function ConfigurationNotice() {
  return (
    <section className="notice" role="status">
      <h2>Account services are not configured</h2>
      <p>
        This installation needs a Supabase project. Set the public Supabase URL,
        publishable key, and application origin in <code>.env.local</code>, then
        apply the database migration. See the README for setup instructions.
      </p>
      <p>No account or project data has been created.</p>
    </section>
  );
}
