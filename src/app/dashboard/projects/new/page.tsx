import { requireUser } from "@/features/auth/session";
import { ProjectForm } from "@/features/projects/components/project-form";
export const metadata = { title: "New project" };
export default async function NewProject() {
  await requireUser();
  return (
    <section className="editor-card">
      <p className="eyebrow">PROJECTS / NEW</p>
      <h1>Create a project.</h1>
      <p>Give your website a home in your workspace.</p>
      <ProjectForm />
    </section>
  );
}
