import { loadReview } from "@/features/releases/queries";
import { isId } from "@/features/reports/model";
import { safeArtifactPath } from "../../../../../../../server/pdf-security.mjs";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; checkId: string }> },
) {
  const { id, checkId } = await params;
  const { client, review, evidence } = await loadReview(id);
  const headers = {
    "Cache-Control": "private, no-store",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
  };
  const absent = () =>
    new Response(
      "Screenshot missing, expired, revoked, or unavailable. No substitute evidence is provided.",
      { status: 404, headers },
    );
  if (!isId(checkId)) return absent();
  const e = evidence.find((v) => v.check_id === checkId);
  if (
    !e ||
    Date.parse(e.expires_at) <= Date.now() ||
    !safeArtifactPath(e.path, review.scan_run_id)
  )
    return absent();
  const permission = await client.rpc("can_read_release_artifact", {
    p_review: id,
    p_check: checkId,
  });
  if (permission.error || !permission.data) return absent();
  const result = await client.storage
    .from("scan-artifacts")
    .download(
      e.path,
      {},
      { signal: AbortSignal.timeout(8000), cache: "no-store" },
    )
    .catch(() => null);
  if (!result || result.error || !result.data || result.data.size > 2097152)
    return absent();
  const final = await client.rpc("can_read_release_artifact", {
    p_review: id,
    p_check: checkId,
  });
  if (final.error || !final.data || Date.parse(e.expires_at) <= Date.now())
    return absent();
  return new Response(result.data, {
    headers: {
      ...headers,
      "Content-Type": "image/png",
      "Content-Disposition": `inline; filename="${e.kind}.png"`,
    },
  });
}
