import { parentPort, workerData } from "node:worker_threads";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { PDFDocument, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { boundedPng } from "./pdf-security.mjs";
// No HTML parser, browser, URL loader, user-supplied script, or remote font access.
globalThis.fetch = () => Promise.reject(new Error("pdf_network_disabled"));
async function render(model, generatedAt) {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(
    await readFile(
      path.join(process.cwd(), "assets/fonts/NotoSans-Regular.ttf"),
    ),
    { subset: true },
  );
  pdf.setTitle("DeployReceipt QA report " + model.report.id);
  pdf.setAuthor("DeployReceipt");
  pdf.setSubject("Observed QA evidence and human triage");
  pdf.setCreationDate(new Date(generatedAt));
  const supported = new Set(font.getCharacterSet());
  let replaced = false;
  const safe = (value) =>
    Array.from(
      String(value ?? "").replace(
        /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g,
        " ",
      ),
    )
      .map((char) => {
        if (
          char === "\n" ||
          char === "\r" ||
          supported.has(char.codePointAt(0))
        )
          return char;
        replaced = true;
        return "?";
      })
      .join("");
  const ink = rgb(0.09, 0.18, 0.16),
    green = rgb(0.08, 0.39, 0.29),
    muted = rgb(0.32, 0.39, 0.36),
    light = rgb(0.94, 0.96, 0.93),
    rust = rgb(0.6, 0.2, 0.16);
  let page, y;
  const width = 595.28,
    height = 841.89,
    margin = 48,
    lineWidth = width - 2 * margin;
  function newPage() {
    if (pdf.getPageCount() >= 30) throw new Error("pdf_page_limit");
    page = pdf.addPage([width, height]);
    y = height - 86;
    page.drawRectangle({
      x: margin,
      y: height - 58,
      width: 22,
      height: 22,
      color: green,
    });
    page.drawText("DR", {
      x: margin + 4,
      y: height - 51,
      size: 9,
      font,
      color: rgb(1, 1, 1),
    });
    page.drawText("DeployReceipt", {
      x: margin + 32,
      y: height - 54,
      size: 17,
      font,
      color: ink,
    });
    page.drawText("QA / EVIDENCE", {
      x: width - margin - 90,
      y: height - 52,
      size: 8,
      font,
      color: muted,
    });
    page.drawLine({
      start: { x: margin, y: height - 72 },
      end: { x: width - margin, y: height - 72 },
      thickness: 0.6,
      color: rgb(0.81, 0.86, 0.82),
    });
  }
  function ensure(space) {
    if (y - space < 60) newPage();
  }
  function wrap(value, size) {
    const lines = [];
    for (const paragraph of safe(value).split(/\r?\n/)) {
      let line = "";
      for (const word of paragraph.split(/\s+/).filter(Boolean)) {
        if (font.widthOfTextAtSize(word, size) > lineWidth) {
          if (line) {
            lines.push(line);
            line = "";
          }
          let part = "";
          for (const char of Array.from(word)) {
            if (font.widthOfTextAtSize(part + char, size) > lineWidth) {
              lines.push(part);
              part = "";
            }
            part += char;
          }
          line = part;
        } else if (
          line &&
          font.widthOfTextAtSize(line + " " + word, size) > lineWidth
        ) {
          lines.push(line);
          line = word;
        } else line += (line ? " " : "") + word;
      }
      lines.push(line);
    }
    return lines;
  }
  function text(value, size = 10, color = ink) {
    for (const line of wrap(value, size)) {
      ensure(size * 1.5);
      page.drawText(line, { x: margin, y: y - size, size, font, color });
      y -= size * 1.5;
    }
    y -= 5;
  }
  function heading(value) {
    ensure(80);
    y -= 8;
    text(value, 14, green);
  }
  newPage();
  text(
    model.report.kind === "diagnostic"
      ? "DIAGNOSTIC REPORT - INCOMPLETE SCAN"
      : "QA EVIDENCE REPORT",
    10,
    model.report.kind === "diagnostic" ? rust : green,
  );
  text(model.report.project_name, 26);
  text(model.report.target_url, 10, muted);
  text("Report " + model.report.id + "\nScan " + model.scan.id, 9, muted);
  const status = model.scan.status.replace("_", " ");
  text(
    "Observed execution status: " + status,
    12,
    model.report.kind === "diagnostic" ? rust : green,
  );
  if (model.report.kind === "diagnostic")
    text(
      "This scan did not complete successfully. Counts include only persisted checks; unexecuted checks are not treated as passes.",
      10,
      rust,
    );
  ensure(76);
  const counts = [
    ["PASSED", model.counts.pass],
    ["FAILED", model.counts.fail],
    ["WARNINGS", model.counts.warning],
  ];
  for (let i = 0; i < 3; i++) {
    const x = margin + i * 171;
    page.drawRectangle({ x, y: y - 64, width: 157, height: 62, color: light });
    page.drawText(String(counts[i][1]), {
      x: x + 14,
      y: y - 32,
      size: 24,
      font,
      color: i === 1 ? rust : green,
    });
    page.drawText(counts[i][0], {
      x: x + 14,
      y: y - 49,
      size: 8,
      font,
      color: muted,
    });
  }
  y -= 82;
  heading("Executive summary");
  text(
    model.findings.length
      ? model.findings.length +
          " checks are recorded. Review failed and warning outcomes, their technical observations, and the separate human triage before deciding what to investigate."
      : "No check observations were persisted. This diagnostic report must not be interpreted as a successful QA run.",
  );
  text(
    "Requested: " +
      model.scan.created_at +
      "\nStarted: " +
      (model.scan.started_at ?? "Not recorded") +
      "\nFinished: " +
      (model.scan.completed_at ?? "Not recorded"),
    9,
    muted,
  );
  text(
    "Elapsed lifecycle: " +
      (model.durationMs === null
        ? "Unknown"
        : (model.durationMs / 1000).toFixed(1) + " seconds") +
      " (may include retry waits).",
    9,
    muted,
  );
  heading("Scope and authorization");
  text(
    "Configuration: " +
      (model.scan.configuration_snapshot
        ? JSON.stringify(model.scan.configuration_snapshot)
        : "Not recorded for this historical scan."),
    9,
  );
  text(
    "Authorization evidence: " +
      (model.scan.verification_snapshot
        ? JSON.stringify(model.scan.verification_snapshot)
        : "Not recorded; the target is the stored scan URL, not a new verification claim."),
    9,
  );
  heading("Coverage limitations");
  model.limitations.forEach((item) => text("- " + item, 9, muted));
  for (const [index, finding] of model.findings.entries()) {
    heading(index + 1 + ". " + finding.check.check_type.toUpperCase());
    text(
      "Automated: " +
        finding.check.outcome.toUpperCase() +
        "   |   Human severity: " +
        (finding.triage.severity ?? "Untriaged") +
        "   |   Status: " +
        finding.triage.resolution,
      10,
    );
    text(finding.check.description, 11);
    if (finding.guidance)
      text("Suggested review: " + finding.guidance, 9, muted);
    text(
      "Check ID: " +
        finding.check.id +
        " | Duration: " +
        (finding.check.duration_ms === null
          ? "Not recorded"
          : finding.check.duration_ms + " ms"),
      8,
      muted,
    );
    if (finding.triage.notes) {
      text("Developer notes", 10, green);
      text(finding.triage.notes, 10);
    }
    if (finding.comments.length) {
      text("Developer comments", 10, green);
      finding.comments.forEach((comment) => {
        text(comment.created_at + " | Project owner", 8, muted);
        text(comment.body, 10);
      });
    }
    if (finding.evidenceIds.length)
      text(
        "Supporting screenshot references: " + finding.evidenceIds.join(", "),
        8,
        muted,
      );
    const details = JSON.stringify(finding.check.details, null, 2);
    text("Technical observations", 10, green);
    text(
      details.slice(0, 2000) +
        (details.length > 2000
          ? "\n[Technical detail abridged after 2,000 characters. Full observation remains in the private report.]"
          : ""),
      8,
      muted,
    );
  }
  if (model.evidence.length) {
    for (const evidence of model.evidence) {
      newPage();
      heading(evidence.type.toUpperCase() + " screenshot evidence");
      text("Evidence check ID: " + evidence.checkId, 8, muted);
      if (evidence.state !== "available" || !evidence.bytes) {
        text(
          "Evidence is unavailable at export time (missing, expired, or could not be loaded). No substitute image or permanent signed URL is included.",
          11,
          rust,
        );
        continue;
      }
      const image = await pdf.embedPng(boundedPng(evidence.bytes));
      const scale = Math.min(lineWidth / image.width, 570 / image.height);
      page.drawImage(image, {
        x: margin + (lineWidth - image.width * scale) / 2,
        y: y - 14 - image.height * scale,
        width: image.width * scale,
        height: image.height * scale,
      });
      y -= image.height * scale + 32;
      text(
        "Actual viewport capture. A screenshot does not establish visual correctness. Retention remains governed by the original scan artifact policy.",
        9,
        muted,
      );
    }
  }
  if (replaced) {
    heading("Text rendering");
    text(
      "Unsupported glyphs are shown as ?. Original text remains available in the application.",
      8,
      muted,
    );
  }
  const pages = pdf.getPages();
  pages.forEach((p, index) => {
    p.drawLine({
      start: { x: margin, y: 44 },
      end: { x: width - margin, y: 44 },
      thickness: 0.5,
      color: rgb(0.81, 0.86, 0.82),
    });
    p.drawText("Generated " + generatedAt + " | Private owner report", {
      x: margin,
      y: 29,
      size: 7,
      font,
      color: muted,
    });
    p.drawText(index + 1 + " / " + pages.length, {
      x: width - margin - 32,
      y: 29,
      size: 8,
      font,
      color: muted,
    });
  });
  const bytes = await pdf.save();
  if (bytes.length > 4194304) throw new Error("pdf_output_limit");
  return bytes;
}
try {
  const bytes = await render(workerData.model, workerData.generatedAt);
  parentPort.postMessage({ ok: true, bytes }, [bytes.buffer]);
} catch (error) {
  parentPort.postMessage({
    ok: false,
    code: ["pdf_page_limit", "pdf_output_limit", "invalid_png"].includes(
      error.message,
    )
      ? error.message
      : "pdf_render_failed",
  });
}
