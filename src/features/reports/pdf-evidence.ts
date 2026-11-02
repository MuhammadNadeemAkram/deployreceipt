import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import type { ReportModel } from "./types";
import { PdfError } from "./pdf";
import { safeArtifactPath } from "../../../server/pdf-security.mjs";
export async function loadPdfEvidence(
  client: SupabaseClient<Database>,
  model: ReportModel,
) {
  if (model.evidence.length > 2) throw new PdfError("pdf_input_limit");
  const output: ReportModel = {
    ...model,
    evidence: model.evidence.map((item) => ({ ...item })),
  };
  await Promise.all(
    output.evidence.map(async (item) => {
      if (item.state !== "available" || !item.path) return;
      if (!safeArtifactPath(item.path, model.scan.id)) {
        item.state = "missing";
        return;
      }
      try {
        const result = await client.storage
          .from("scan-artifacts")
          .download(
            item.path,
            {},
            { signal: AbortSignal.timeout(8000), cache: "no-store" },
          );
        if (result.error || !result.data) {
          item.state =
            result.error &&
            "statusCode" in result.error &&
            String(result.error.statusCode) === "404"
              ? "missing"
              : "unavailable";
          return;
        }
        if (result.data.size > 2097152) {
          item.state = "unavailable";
          return;
        }
        item.bytes = new Uint8Array(await result.data.arrayBuffer());
      } catch {
        item.state = "unavailable";
      }
    }),
  );
  return output;
}
