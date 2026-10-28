"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/features/auth/session";
import { text, type FormState } from "@/features/auth/validation";
import { validateProject, isProjectId } from "./validation";

export async function saveProject(
  id: string | null,
  _state: FormState,
  form: FormData,
): Promise<FormState> {
  const { client, user } = await requireUser();
  const { values, errors } = validateProject(form);
  if (Object.keys(errors).length)
    return {
      error: "Please check the highlighted fields.",
      fieldErrors: errors,
    };
  if (id !== null && !isProjectId(id))
    return { error: "Project not found or no longer accessible." };
  try {
    // No client-supplied owner is accepted; INSERT uses auth.uid() in PostgreSQL.
    const query =
      id === null
        ? client.from("projects").insert(values)
        : client
            .from("projects")
            .update(values)
            .eq("id", id)
            .eq("owner_id", user.id);
    const { data, error } = await query.select("id").single();
    if (error || !data)
      return {
        error:
          "Unable to save this project. It may no longer be accessible. Please try again.",
      };
  } catch {
    return {
      error: "Project services are temporarily unavailable. Please try again.",
    };
  }
  revalidatePath("/dashboard");
  redirect(
    id === null ? "/dashboard?notice=created" : "/dashboard?notice=updated",
  );
}

export async function deleteProject(
  id: string,
  _state: FormState,
  form: FormData,
): Promise<FormState> {
  const { client, user } = await requireUser();
  if (!isProjectId(id))
    return { error: "Project not found or no longer accessible." };
  if (text(form, "confirmation") !== "delete")
    return {
      error: "Confirm that you want to permanently delete this project.",
    };
  try {
    const { data, error } = await client
      .from("projects")
      .delete()
      .eq("id", id)
      .eq("owner_id", user.id)
      .select("id")
      .single();
    if (error || !data)
      return {
        error:
          "Unable to delete this project. It may already be removed or no longer accessible.",
      };
  } catch {
    return {
      error: "Project services are temporarily unavailable. Please try again.",
    };
  }
  revalidatePath("/dashboard");
  redirect("/dashboard?notice=deleted");
}
