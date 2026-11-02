import { ownedScan } from "@/features/scans/queries";
export const dynamic = "force-dynamic";
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { client, run } = await ownedScan((await params).id);
  const { data, error } = await client
    .from("scan_checks")
    .select("*")
    .eq("scan_run_id", run.id);
  if (error)
    return Response.json(
      { error: "Unable to load findings." },
      { status: 503 },
    );
  const { lease_token: _lease, lease_until: _until, ...safe } = run;
  void _lease;
  void _until;
  return Response.json(
    { scan: safe, checks: data },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
