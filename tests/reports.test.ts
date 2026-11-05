import { describe, it, expect, vi } from "vitest";
import { PDFDocument, PDFName } from "pdf-lib";
import { buildReport, validateTriage } from "@/features/reports/model";
import { renderReportPdf, claimPdfSlot } from "@/features/reports/pdf";
import { loadPdfEvidence } from "@/features/reports/pdf-evidence";
import { boundedPng, safeArtifactPath } from "../server/pdf-security.mjs";
import {
  reportFixture,
  sampleReport,
  pngFixture,
  runId,
} from "./report-fixture";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
describe("report integrity", () => {
  it("derives counts and duration from persisted records", () => {
    const model = sampleReport();
    expect(model.counts).toEqual({ pass: 3, fail: 1, warning: 2 });
    expect(model.durationMs).toBe(7000);
    expect(model.findings).toHaveLength(6);
  });
  it("preserves automated outcomes when triage resolves a finding", () => {
    const input = reportFixture();
    input.triage[4].resolution = "resolved";
    input.triage[4].severity = "high";
    const model = buildReport(input);
    expect(model.findings[4].check.outcome).toBe("fail");
    expect(model.counts.fail).toBe(1);
    expect(model.findings[4].triage.resolution).toBe("resolved");
  });
  it("does not invent historical configuration or authorization", () => {
    const input = reportFixture();
    input.scan.configuration_snapshot = null;
    input.scan.verification_snapshot = null;
    const model = buildReport(input);
    expect(model.limitations.join(" ")).toContain("not recorded");
    expect(model.scan.configuration_snapshot).toBeNull();
  });
  it.each(["queued", "running"] as const)(
    "rejects nonterminal %s scans",
    (status) => {
      const input = reportFixture();
      input.scan.status = status;
      expect(() => buildReport(input)).toThrow("report_data_inconsistent");
    },
  );
  it.each(["failed", "timed_out"] as const)(
    "labels %s reports diagnostic and does not invent checks",
    (status) => {
      const input = reportFixture();
      input.scan.status = status;
      input.report.kind = "diagnostic";
      input.checks = [];
      input.triage = [];
      const model = buildReport(input);
      expect(model.findings).toEqual([]);
      expect(model.counts).toEqual({ pass: 0, fail: 0, warning: 0 });
      expect(model.limitations[0]).toContain("INCOMPLETE");
    },
  );
  it("rejects inconsistent counts, cross-scan checks, and absent triage", () => {
    const input = reportFixture();
    input.scan.passed_count = 6;
    expect(() => buildReport(input)).toThrow();
    const foreign = reportFixture();
    foreign.checks[0].scan_run_id = "other";
    expect(() => buildReport(foreign)).toThrow();
    const missing = reportFixture();
    missing.triage = [];
    expect(() => buildReport(missing)).toThrow();
  });
  it("marks evidence expired rather than extending retention", () => {
    const input = reportFixture();
    input.now = new Date("2026-11-20T00:00:00Z");
    expect(
      buildReport(input).evidence.every((item) => item.state === "expired"),
    ).toBe(true);
  });
  it("validates manual fields independently from automated outcomes", () => {
    const form = new FormData();
    form.set("severity", "automatic-critical");
    form.set("resolution", "passed");
    form.set("notes", "x".repeat(2001));
    form.set("revision", "0");
    const result = validateTriage(form);
    expect(Object.keys(result.errors)).toHaveLength(4);
  });
});
describe("private evidence and renderer limits", () => {
  it("rejects arbitrary URLs and path traversal", () => {
    expect(safeArtifactPath(runId + "/1/desktop.png", runId)).toBe(true);
    for (const value of [
      "http://169.254.169.254/a.png",
      runId + "/../secret",
      runId + "/99/desktop.png",
      "other/1/desktop.png",
    ])
      expect(safeArtifactPath(value, runId)).toBe(false);
  });
  it("accepts bounded real PNG data but rejects malformed/dangerous dimensions", () => {
    expect(boundedPng(pngFixture()).length).toBeGreaterThan(30);
    expect(() =>
      boundedPng(Buffer.from("<svg onload='fetch(...)'/>")),
    ).toThrow();
    const malicious = pngFixture();
    malicious.writeUInt32BE(99999999, 16);
    expect(() => boundedPng(malicious)).toThrow();
    expect(() => boundedPng(Buffer.alloc(2097153))).toThrow();
  });
  it("downloads only authorized stored paths and marks missing evidence", async () => {
    const download = vi.fn().mockResolvedValue({
      data: null,
      error: { message: "not found", statusCode: 404 },
    });
    const client = {
      storage: { from: () => ({ download }) },
    } as unknown as SupabaseClient<Database>;
    const model = sampleReport();
    const payload = await loadPdfEvidence(client, model);
    expect(download).toHaveBeenCalledTimes(2);
    expect(payload.evidence.every((item) => item.state === "missing")).toBe(
      true,
    );
  });
  it("never fetches expired or external evidence", async () => {
    const download = vi.fn();
    const client = {
      storage: { from: () => ({ download }) },
    } as unknown as SupabaseClient<Database>;
    const model = sampleReport();
    model.evidence[0].state = "expired";
    model.evidence[1].path = "http://127.0.0.1/private.png";
    await loadPdfEvidence(client, model);
    expect(download).not.toHaveBeenCalled();
  });
  it("limits concurrent PDF threads and releases slots", () => {
    const a = claimPdfSlot(),
      b = claimPdfSlot();
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(claimPdfSlot()).toBeNull();
    a!();
    a!();
    const c = claimPdfSlot();
    expect(c).not.toBeNull();
    b!();
    c!();
  });
  it("renders a valid branded PDF with private PNG bytes and literal malicious HTML", async () => {
    const model = sampleReport();
    model.findings[0].triage.notes =
      '<script>fetch("http://169.254.169.254/secret")</script><img src="https://evil.invalid/x">';
    model.evidence.forEach((item) => {
      item.bytes = pngFixture();
    });
    const bytes = await renderReportPdf(model, "2026-11-02T12:00:00Z");
    const doc = await PDFDocument.load(bytes);
    expect(doc.getTitle()).toContain("DeployReceipt");
    expect(doc.getPageCount()).toBeGreaterThan(2);
    expect(doc.catalog.get(PDFName.of("OpenAction"))).toBeUndefined();
    expect(doc.catalog.get(PDFName.of("AA"))).toBeUndefined();
    expect(
      doc
        .getPages()
        .some((page) => page.node.Resources()?.lookup(PDFName.of("XObject"))),
    ).toBe(true);
  }, 15000);
  it("exports missing evidence and failed scans without substituting success", async () => {
    const input = reportFixture();
    input.scan.status = "timed_out";
    input.report.kind = "diagnostic";
    input.checks = [];
    input.triage = [];
    const model = buildReport(input);
    const bytes = await renderReportPdf(model);
    expect((await PDFDocument.load(bytes)).getPageCount()).toBeGreaterThan(0);
  });
  it("rejects oversized input before starting a render", async () => {
    const model = sampleReport();
    model.findings[0].triage.notes = "x".repeat(600000);
    await expect(renderReportPdf(model)).rejects.toThrow("pdf_input_limit");
  });
});

it("carries public policy blocks and unexecuted coverage into the report/PDF model", () => {
  const input = reportFixture();
  input.scan.configuration_snapshot = {
    mode: "public",
    transport: "pinned_gateway_v1",
  };
  input.checks.find((c) => c.check_type === "network")!.details.policy_blocked =
    3;
  input.checks.find((c) => c.check_type === "mobile")!.details.executed = false;
  const model = buildReport(input);
  expect(model.limitations.join(" ")).toContain("Authorized public scan");
  expect(model.limitations.join(" ")).toContain("Policy-blocked requests: 3");
  expect(model.limitations.join(" ")).toContain("mobile");
});
