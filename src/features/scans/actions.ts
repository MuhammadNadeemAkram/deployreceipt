"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/features/auth/session";
import { isProjectId } from "@/features/projects/validation";
import type { FormState } from "@/features/auth/validation";
const messages: Record<string, string> = {
  scanning_disabled:
    "Public website scanning is disabled. Only the isolated local fixture mode is available.",
  fixture_only: "This installation permits only the controlled fixture URL.",
  verification_required: "Verify this project before requesting a scan.",
  scan_already_active: "A scan is already queued or running for this project.",
  scan_cooldown: "Please wait before requesting another scan.",
  daily_allowance: "Your daily scan allowance has been reached.",
  verification_cooldown: "Please wait 30 seconds before rechecking.",
  verification_busy: "Verification is already running.",
  invalid_domain:
    "Use a public DNS domain, or the controlled fixture in local mode.",
};
export async function requestScan(
  projectId: string,
  _state: FormState,
): Promise<FormState> {
  void _state;
  const { client, user } = await requireUser();
  if (!isProjectId(projectId)) return { error: "Project not found." };
  const { data: project } = await client
    .from("projects")
    .select("id")
    .eq("id", projectId)
    .eq("owner_id", user.id)
    .maybeSingle();
  if (!project) return { error: "Project not found." };
  let scanId: string | null = null;
  try {
    const { data, error } = await client.rpc("request_scan", {
      p_project_id: projectId,
    });
    if (error)
      return {
        error:
          messages[error.message] ??
          "Unable to queue the scan. Check configuration and try again.",
      };
    scanId = data;
  } catch {
    return { error: "Scan services are unavailable." };
  }
  revalidatePath(`/dashboard/projects/${projectId}`);
  if (scanId) redirect(`/dashboard/scans/${scanId}`);
  return { error: "Unable to queue the scan." };
}
export async function requestVerification(
  projectId: string,
  _state: FormState,
): Promise<FormState> {
  void _state;
  const { client, user } = await requireUser();
  if (!isProjectId(projectId)) return { error: "Project not found." };
  const { data: project } = await client
    .from("projects")
    .select("id")
    .eq("id", projectId)
    .eq("owner_id", user.id)
    .maybeSingle();
  if (!project) return { error: "Project not found." };
  try {
    const { error } = await client.rpc("request_domain_verification", {
      p_project_id: projectId,
    });
    if (error)
      return {
        error: messages[error.message] ?? "Unable to request verification.",
      };
  } catch {
    return { error: "Verification services are unavailable." };
  }
  revalidatePath(`/dashboard/projects/${projectId}`);
  return {
    success:
      "Verification queued. A worker will check the challenge. Add the TXT record below and recheck if needed.",
  };
}
