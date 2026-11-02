import { ownedReport } from "@/features/reports/queries";
import {
  claimPdfSlot,
  renderReportPdf,
  PdfError,
} from "@/features/reports/pdf";
import { loadPdfEvidence } from "@/features/reports/pdf-evidence";
import { getSiteOrigin } from "@/lib/supabase/config";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  let origin: string;
  try {
    origin = getSiteOrigin();
  } catch {
    return Response.json(
      { error: "Application origin is not configured." },
      { status: 503 },
    );
  }
  if (request.headers.get("origin") !== origin)
    return Response.json({ error: "Invalid request origin." }, { status: 403 });
  const { client, model } = await ownedReport((await params).id);
  const releaseSlot = claimPdfSlot();
  if (!releaseSlot)
    return Response.json(
      { error: "PDF generation is busy. Please try again." },
      { status: 429 },
    );
  let token: string | null = null;
  try {
    const claim = await client.rpc("claim_qa_export", {
      p_report_id: model.report.id,
    });
    if (claim.error || !claim.data)
      return Response.json(
        { error: "Please wait before exporting again." },
        { status: 429 },
      );
    token = claim.data;
    const payload = await loadPdfEvidence(client, model);
    const bytes = await renderReportPdf(payload);
    // Revocation/project deletion during generation must not produce a fresh download.
    const final = await client
      .from("qa_reports")
      .select("id")
      .eq("id", model.report.id)
      .maybeSingle();
    if (final.error || !final.data)
      return Response.json(
        { error: "Report no longer available." },
        { status: 404 },
      );
    return new Response(Buffer.from(bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="DeployReceipt-${model.report.id}.pdf"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
      },
    });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof PdfError &&
          ["pdf_input_limit", "pdf_page_limit", "pdf_output_limit"].includes(
            error.message,
          )
            ? "This report exceeds the PDF limits. Review the complete report in the application."
            : "Unable to generate PDF. Please try again.",
      },
      { status: 422 },
    );
  } finally {
    releaseSlot();
    if (token)
      await client
        .rpc("release_qa_export", { p_token: token })
        .abortSignal(AbortSignal.timeout(3000))
        .then(
          () => undefined,
          () => undefined,
        );
  }
}
