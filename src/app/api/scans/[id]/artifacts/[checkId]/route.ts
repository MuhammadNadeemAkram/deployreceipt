import { ownedScan } from "@/features/scans/queries";
import { isProjectId } from "@/features/projects/validation";
export const dynamic = "force-dynamic";
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; checkId: string }> },
) {
  const { id, checkId } = await params;
  const { client, run } = await ownedScan(id);
  if (!isProjectId(checkId)) return new Response("Not found", { status: 404 });
  const { data: check } = await client
    .from("scan_checks")
    .select("screenshot_path")
    .eq("scan_run_id", run.id)
    .eq("id", checkId)
    .maybeSingle();
  if (!check?.screenshot_path)
    return new Response("Artifact unavailable", { status: 404 });
  const { data, error } = await client.storage
    .from("scan-artifacts")
    .createSignedUrl(check.screenshot_path, 60);
  if (error || !data)
    return new Response("Artifact expired or unavailable", { status: 404 });
  return new Response(null, {
    status: 303,
    headers: {
      Location: data.signedUrl,
      "Cache-Control": "private, no-store",
      "Referrer-Policy": "no-referrer",
    },
  });
}
