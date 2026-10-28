import Link from "next/link";
import { requireUser } from "@/features/auth/session";

const notices: Record<string, string> = {
  created: "Project created.",
  updated: "Project updated.",
  deleted: "Project deleted.",
};
export default async function Dashboard({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string }>;
}) {
  const { client, user } = await requireUser();
  const { data: projects, error } = await client
    .from("projects")
    .select("*")
    .eq("owner_id", user.id)
    .order("created_at", { ascending: false });
  if (error) throw new Error("Unable to load projects.");
  const { notice } = await searchParams;
  return (
    <>
      <div className="dashboard-title">
        <div>
          <p className="eyebrow">PROJECTS</p>
          <h1>Your websites, organized.</h1>
          <p>Manage the projects you’re preparing to release.</p>
        </div>
        <Link className="button" href="/dashboard/projects/new">
          New project +
        </Link>
      </div>
      {notice && notices[notice] && (
        <p className="form-success" role="status">
          {notices[notice]}
        </p>
      )}
      {!projects?.length ? (
        <section className="empty-state">
          <span className="empty-icon" aria-hidden="true">
            ↗
          </span>
          <h2>Start with your first project.</h2>
          <p>
            Add a website and a little context. Your projects will stay here
            between sessions.
          </p>
          <Link className="button" href="/dashboard/projects/new">
            Create a project
          </Link>
          <p className="field-hint">No scans are run when you add a website.</p>
        </section>
      ) : (
        <ul className="project-grid">
          {projects.map((project) => (
            <li className="project-card" key={project.id}>
              <p className="eyebrow">WEBSITE PROJECT</p>
              <h2>{project.name}</h2>
              <a
                className="project-url"
                href={project.website_url}
                target="_blank"
                rel="noopener noreferrer"
              >
                {project.website_url}
                <span className="sr-only"> (opens in a new tab)</span>
              </a>
              {project.description && (
                <p className="project-description">{project.description}</p>
              )}
              <p className="project-date">
                Created{" "}
                <time dateTime={project.created_at}>
                  {new Intl.DateTimeFormat("en", {
                    dateStyle: "medium",
                    timeZone: "UTC",
                  }).format(new Date(project.created_at))}
                </time>
              </p>
              <div className="project-actions">
                <Link href={`/dashboard/projects/${project.id}/edit`}>
                  Edit project
                </Link>
                <Link
                  className="danger-link"
                  href={`/dashboard/projects/${project.id}/delete`}
                >
                  Delete
                </Link>
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
