import { getProject } from "@/features/projects/queries";
import { ProjectForm } from "@/features/projects/components/project-form";
export const metadata = { title: "Edit project" };
export default async function EditProject({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const project = await getProject((await params).id);
  return (
    <section className="editor-card">
      <p className="eyebrow">PROJECTS / EDIT</p>
      <h1>Edit project.</h1>
      <p>Keep the details for {project.name} up to date.</p>
      <ProjectForm project={project} />
    </section>
  );
}
