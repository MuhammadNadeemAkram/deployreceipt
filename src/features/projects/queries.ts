import "server-only";
import { notFound } from "next/navigation";
import { requireUser } from "@/features/auth/session";
import { isProjectId } from "./validation";

export async function getProject(id: string) {
  const { client, user } = await requireUser();
  if (!isProjectId(id)) notFound();
  const { data, error } = await client
    .from("projects")
    .select("*")
    .eq("id", id)
    .eq("owner_id", user.id)
    .maybeSingle();
  if (error) throw new Error("Unable to load the project.");
  if (!data) notFound();
  return data;
}
