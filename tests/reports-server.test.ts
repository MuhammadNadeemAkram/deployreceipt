import { beforeEach, it, expect, vi } from "vitest";
const m = vi.hoisted(() => ({
  requireUser: vi.fn(),
  rpc: vi.fn(),
  render: vi.fn(),
  evidence: vi.fn(),
  rows: {} as Record<string, unknown>,
  filters: [] as Array<{ table: string; column: string; value: unknown }>,
  signed: vi.fn(),
}));
vi.mock("@/features/auth/session", () => ({ requireUser: m.requireUser }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
  redirect: (value: string) => {
    throw new Error("REDIRECT:" + value);
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase/config", () => ({
  getSiteOrigin: () => "https://app.example.test",
}));
vi.mock("@/features/reports/pdf", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/features/reports/pdf")>();
  return { ...original, renderReportPdf: m.render };
});
vi.mock("@/features/reports/pdf-evidence", () => ({
  loadPdfEvidence: m.evidence,
}));
import { reportFixture, reportId, runId } from "./report-fixture";
import { ownedReport } from "@/features/reports/queries";
import {
  createReport,
  saveTriage,
  addComment,
} from "@/features/reports/actions";
import { POST } from "@/app/api/reports/[id]/pdf/route";
import { claimPdfSlot } from "@/features/reports/pdf";
function form(values: Record<string, string>) {
  const result = new FormData();
  Object.entries(values).forEach(([key, value]) => result.set(key, value));
  return result;
}
beforeEach(() => {
  vi.resetAllMocks();
  m.filters.length = 0;
  const fixture = reportFixture();
  fixture.scan.created_at = new Date().toISOString();
  m.rows = {
    qa_reports: fixture.report,
    projects: { id: fixture.report.project_id },
    scan_runs: fixture.scan,
    scan_checks: fixture.checks,
    qa_finding_triage: fixture.triage,
    qa_comments: [],
    qa_finding_evidence: [],
    scan_settings: { retention_days: 7 },
  };
  const from = (table: string) => {
    const result = () => ({ data: m.rows[table] ?? null, error: null });
    const query = {
      select: () => query,
      eq: (column: string, value: unknown) => {
        m.filters.push({ table, column, value });
        return query;
      },
      order: () => query,
      abortSignal: () => query,
      maybeSingle: () => Promise.resolve(result()),
      single: () => Promise.resolve(result()),
      then: (
        resolve: (value: ReturnType<typeof result>) => unknown,
        reject?: (error: unknown) => unknown,
      ) => Promise.resolve(result()).then(resolve, reject),
    };
    return query;
  };
  m.signed.mockResolvedValue({
    data: { signedUrl: "https://storage.example.test/private-token" },
    error: null,
  });
  m.rpc.mockImplementation((name: string) => {
    const promise = Promise.resolve({
      data:
        name === "create_qa_report"
          ? reportId
          : name === "claim_qa_export"
            ? "88888888-8888-4888-8888-888888888888"
            : null,
      error: null,
    });
    return Object.assign(promise, { abortSignal: () => promise });
  });
  m.requireUser.mockResolvedValue({
    client: {
      from,
      rpc: m.rpc,
      storage: { from: () => ({ createSignedUrl: m.signed }) },
    },
    user: { id: "owner" },
  });
  m.render.mockResolvedValue(new Uint8Array(Buffer.from("%PDF-1.7\n")));
  m.evidence.mockImplementation(async (_client, model) => model);
});
it("creates only from a persisted scan ID", async () => {
  await expect(createReport(runId, {})).rejects.toThrow(
    "REDIRECT:/dashboard/reports/" + reportId,
  );
  expect(m.rpc).toHaveBeenCalledWith("create_qa_report", { p_scan_id: runId });
});
it("requires authentication before report creation", async () => {
  m.requireUser.mockRejectedValue(new Error("REDIRECT:/login"));
  await expect(createReport(runId, {})).rejects.toThrow("/login");
  expect(m.rpc).not.toHaveBeenCalled();
});
it("validates triage and never submits an automated outcome", async () => {
  const check = reportFixture().checks[0].id;
  expect(
    (
      await saveTriage(
        reportId,
        check,
        {},
        form({
          severity: "high",
          resolution: "investigating",
          notes: "Developer note",
          revision: "1",
          outcome: "pass",
        }),
      )
    ).success,
  ).toContain("unchanged");
  expect(m.rpc).toHaveBeenCalledWith(
    "save_qa_triage",
    expect.not.objectContaining({ outcome: expect.anything() }),
  );
  expect(
    (
      await saveTriage(
        reportId,
        check,
        {},
        form({
          severity: "urgent",
          resolution: "passed",
          notes: "",
          revision: "1",
        }),
      )
    ).error,
  ).toBeDefined();
});
it("rejects empty and oversized comments", async () => {
  const check = reportFixture().checks[0].id;
  expect(
    (await addComment(reportId, check, {}, form({ comment: " " }))).error,
  ).toBeDefined();
  expect(
    (await addComment(reportId, check, {}, form({ comment: "x".repeat(2001) })))
      .error,
  ).toBeDefined();
  expect(m.rpc).not.toHaveBeenCalled();
});
it("hides another owner's reports before signing evidence", async () => {
  m.rows.projects = null;
  await expect(ownedReport(reportId)).rejects.toThrow("NOT_FOUND");
  expect(m.signed).not.toHaveBeenCalled();
  expect(m.filters).toContainEqual({
    table: "projects",
    column: "owner_id",
    value: "owner",
  });
});
it("returns not found after deletion", async () => {
  m.rows.qa_reports = null;
  await expect(ownedReport(reportId)).rejects.toThrow("NOT_FOUND");
});
it("does not persist signed URLs in the report model", async () => {
  const { model } = await ownedReport(reportId);
  expect(JSON.stringify(model)).not.toContain("private-token");
});
const request = (origin = "https://app.example.test") =>
  new Request("https://app.example.test/api/reports/" + reportId + "/pdf", {
    method: "POST",
    headers: { origin },
  });
const context = () => ({ params: Promise.resolve({ id: reportId }) });
it("rejects cross-origin exports before data access", async () => {
  expect((await POST(request("https://evil.invalid"), context())).status).toBe(
    403,
  );
  expect(m.requireUser).not.toHaveBeenCalled();
});
it("blocks cross-user PDF exports", async () => {
  m.rows.projects = null;
  await expect(POST(request(), context())).rejects.toThrow("NOT_FOUND");
  expect(m.render).not.toHaveBeenCalled();
});
it("returns private PDF attachment and releases the lease", async () => {
  const response = await POST(request(), context());
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toBe("application/pdf");
  expect(response.headers.get("content-disposition")).toContain(
    reportId + ".pdf",
  );
  expect(response.headers.get("cache-control")).toContain("no-store");
  expect(m.evidence).toHaveBeenCalledTimes(1);
  expect(m.rpc).toHaveBeenCalledWith("release_qa_export", {
    p_token: "88888888-8888-4888-8888-888888888888",
  });
});
it("revokes export if deletion occurs during rendering", async () => {
  m.render.mockImplementation(async () => {
    m.rows.qa_reports = null;
    return new Uint8Array(Buffer.from("%PDF-1.7"));
  });
  expect((await POST(request(), context())).status).toBe(404);
});
it("releases slots and hides renderer internals on failure", async () => {
  m.render.mockRejectedValue(new Error("private internals"));
  const response = await POST(request(), context());
  expect(response.status).toBe(422);
  expect(JSON.stringify(await response.json())).not.toContain("internals");
  const a = claimPdfSlot(),
    b = claimPdfSlot();
  expect(a).not.toBeNull();
  expect(b).not.toBeNull();
  a!();
  b!();
});
