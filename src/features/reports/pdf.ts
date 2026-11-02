import "server-only";
import { Worker } from "node:worker_threads";
import path from "node:path";
import type { ReportModel } from "./types";
export class PdfError extends Error {}
export async function renderReportPdf(
  model: ReportModel,
  generatedAt = new Date().toISOString(),
): Promise<Uint8Array> {
  const textOnly = {
    ...model,
    evidence: model.evidence.map(({ bytes, ...evidence }) => {
      void bytes;
      return evidence;
    }),
  };
  if (
    Buffer.byteLength(JSON.stringify(textOnly)) > 524288 ||
    model.evidence.length > 2 ||
    model.evidence.some((item) => (item.bytes?.length ?? 0) > 2097152)
  )
    throw new PdfError("pdf_input_limit");
  return new Promise((resolve, reject) => {
    const worker = new Worker(
      path.join(process.cwd(), "server/report-pdf-worker.mjs"),
      {
        workerData: { model, generatedAt },
        env: {},
        resourceLimits: {
          maxOldGenerationSizeMb: 128,
          maxYoungGenerationSizeMb: 16,
          stackSizeMb: 4,
        },
      },
    );
    let settled = false;
    const finish = (error: Error | null, bytes?: Uint8Array) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void worker.terminate();
      if (error) reject(error);
      else resolve(bytes!);
    };
    const timer = setTimeout(() => finish(new PdfError("pdf_timeout")), 12000);
    worker.once(
      "message",
      (result: { ok: boolean; bytes?: Uint8Array; code?: string }) => {
        if (!result.ok || !result.bytes || result.bytes.length > 8388608)
          finish(new PdfError(result.code ?? "pdf_render_failed"));
        else finish(null, result.bytes);
      },
    );
    worker.once("error", () => finish(new PdfError("pdf_render_failed")));
    worker.once("exit", () => {
      if (!settled) finish(new PdfError("pdf_render_failed"));
    });
  });
}
let active = 0;
export function claimPdfSlot() {
  if (active >= 2) return null;
  active++;
  let released = false;
  return () => {
    if (!released) {
      active--;
      released = true;
    }
  };
}
