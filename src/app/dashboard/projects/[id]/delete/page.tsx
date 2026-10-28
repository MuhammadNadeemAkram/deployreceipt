import { getProject } from "@/features/projects/queries";
import { DeleteProjectForm } from "@/features/projects/components/delete-project-form";
export const metadata = { title: "Delete project" };
export default async function DeleteProject({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const project = await getProject((await params).id);
  return (
    <section className="editor-card">
      <p className="eyebrow">PROJECTS / DELETE</p>
      <h1>Delete {project.name}?</h1>
      <p>
        This permanently removes this project and its saved details. This action
        cannot be undone.
      </p>
      <DeleteProjectForm id={project.id} />
    </section>
  );
}
