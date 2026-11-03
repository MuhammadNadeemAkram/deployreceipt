import { loadReview } from "@/features/releases/queries";
export const dynamic = "force-dynamic";
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const data = await loadReview((await params).id);
  return Response.json(
    {
      review: data.review,
      comments: data.comments,
      decisions: data.decisions,
      evidence: data.evidence.map((e) => ({
        check_id: e.check_id,
        kind: e.kind,
        expires_at: e.expires_at,
      })),
    },
    {
      headers: {
        "Cache-Control": "private, no-store",
        "Referrer-Policy": "no-referrer",
      },
    },
  );
}
