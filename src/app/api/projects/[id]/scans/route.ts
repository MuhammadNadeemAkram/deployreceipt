import { getProject } from "@/features/projects/queries";
import { requireUser } from "@/features/auth/session";
export const dynamic = "force-dynamic";
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const project = await getProject((await params).id);
  const { client } = await requireUser();
  const { data, error } = await client
    .from("scan_runs")
    .select(
      "id,status,created_at,completed_at,passed_count,failed_count,warning_count",
    )
    .eq("project_id", project.id)
    .order("created_at", { ascending: false })
    .limit(20);
  if (error)
    return Response.json({ error: "Unable to list scans." }, { status: 503 });
  return Response.json(
    { scans: data },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
