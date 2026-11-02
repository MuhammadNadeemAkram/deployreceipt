import "server-only";
import { notFound } from "next/navigation";
import { requireUser } from "@/features/auth/session";
import { isProjectId } from "@/features/projects/validation";
export async function ownedScan(id: string) {
  const { client, user } = await requireUser();
  if (!isProjectId(id)) notFound();
  const { data: run, error } = await client
    .from("scan_runs")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error("Unable to load scan.");
  if (!run) notFound();
  const { data: project } = await client
    .from("projects")
    .select("*")
    .eq("id", run.project_id)
    .eq("owner_id", user.id)
    .maybeSingle();
  if (!project) notFound();
  return { client, run, project };
}
