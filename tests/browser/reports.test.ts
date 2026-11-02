import { afterAll, beforeAll, it, expect, vi } from "vitest";
import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { chromium, type Browser } from "playwright";
const state = vi.hoisted(() => ({
  model:
    null as unknown as import("../../src/features/reports/types").ReportModel,
}));
vi.mock("@/features/reports/queries", () => ({
  ownedReport: async () => ({ model: state.model }),
}));
vi.mock("@/features/auth/session", () => ({
  requireUser: async () => ({
    user: { id: "fixture-owner", email: "owner@example.test" },
  }),
}));
vi.mock("@/lib/supabase/config", () => ({
  getSupabaseConfig: () => ({
    url: "https://fixture.invalid",
    key: "sb_publishable_fixture",
  }),
}));
vi.mock("@/features/reports/actions", () => ({
  saveTriage: async () => ({}),
  addComment: async () => ({}),
  createReport: async () => ({}),
}));
vi.mock("@/features/auth/actions", () => ({ signOut: async () => ({}) }));
import ReportPage from "@/app/dashboard/reports/[id]/page";
import DashboardLayout from "@/app/dashboard/layout";
import { sampleReport, reportId } from "../report-fixture";
let browser: Browser,
  origin = "",
  css = "";
const screenshots: Record<string, Buffer> = {};
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? "/", "http://fixture");
    if (url.pathname === "/capture") {
      response.setHeader("Content-Type", "text/html");
      response.end(
        '<!doctype html><html><meta charset="utf-8"><style>body{font:22px Arial;background:#f3f7f1;color:#173d2d;padding:36px}article{padding:24px;background:white;border:1px solid #c8d8c9;border-radius:10px}h1{font-size:38px}</style><article><h1>Controlled fixture capture</h1><p>Test evidence for report layout verification.</p><p>This is not a customer website or a live persisted scan.</p></article></html>',
      );
      return;
    }
    if (url.pathname.includes("/artifacts/")) {
      const item = state.model.evidence.find((item) =>
        url.pathname.endsWith(item.checkId),
      );
      const image = item ? screenshots[item.type] : null;
      if (!image) {
        response.statusCode = 404;
        response.end();
        return;
      }
      response.setHeader("Content-Type", "image/png");
      response.end(image);
      return;
    }
    const view = await ReportPage({
      params: Promise.resolve({ id: reportId }),
      searchParams: Promise.resolve(Object.fromEntries(url.searchParams)),
    });
    const workspace = await DashboardLayout({ children: view });
    response.setHeader("Content-Type", "text/html; charset=utf-8");
    response.end(
      '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width"><title>DeployReceipt report UI test fixture</title><style>' +
        css +
        '</style></head><body><div style="padding:10px 20px;background:#fff3d9;color:#604100;font:12px Arial">UI TEST FIXTURE — controlled test records; not an authenticated live scan report. Triage/export controls are shown for layout review.</div>' +
        renderToStaticMarkup(workspace) +
        "</body></html>",
    );
  } catch (error) {
    response.statusCode = 500;
    response.end(String(error));
  }
});
beforeAll(async () => {
  if (process.env.NODE_ENV !== "test") throw new Error("test_only");
  state.model = sampleReport();
  state.model.findings[4].triage.severity = "medium";
  state.model.findings[4].triage.resolution = "investigating";
  state.model.findings[4].triage.notes =
    "Confirm the broken fixture link and keep the original observation intact.";
  css = (
    await readFile(path.join(process.cwd(), "src/app/globals.css"), "utf8")
  ).replace('@import "tailwindcss";', "");
  await mkdir("outputs", { recursive: true });
  await mkdir("work", { recursive: true });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("fixture");
  origin = "http://127.0.0.1:" + address.port;
  browser = await chromium.launch({ headless: true });
  for (const [type, viewport] of [
    ["desktop", { width: 1440, height: 900 }],
    ["mobile", { width: 390, height: 844 }],
  ] as const) {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    await page.goto(origin + "/capture");
    screenshots[type] = await page.screenshot();
    await writeFile("work/report-evidence-" + type + ".png", screenshots[type]);
    await context.close();
  }
  await writeFile("work/report-model.json", JSON.stringify(state.model));
});
afterAll(async () => {
  await browser?.close();
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});
it("renders the report dashboard and preserves desktop layout", async () => {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  const page = await context.newPage();
  await page.goto(origin + "/dashboard/reports/" + reportId);
  await expect(
    page
      .getByRole("heading", { name: "Controlled test fixture", exact: true })
      .count(),
  ).resolves.toBe(1);
  expect(
    await page.getByText("Automated passes", { exact: true }).count(),
  ).toBe(1);
  await page.screenshot({ path: "outputs/task04-report-desktop.png" });
  await page
    .getByRole("heading", { name: "Review findings", exact: true })
    .scrollIntoViewIfNeeded();
  await page.screenshot({ path: "outputs/task04-report-findings.png" });
  await page.locator("#filter-outcome").selectOption("fail");
  await page
    .getByRole("button", { name: "Apply filters", exact: true })
    .click();
  expect(
    await page
      .getByText("Showing 1 of 6 persisted observations.", { exact: true })
      .count(),
  ).toBe(1);
  await context.close();
});
it("fits narrow mobile screens without horizontal overflow", async () => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();
  await page.goto(origin + "/dashboard/reports/" + reportId);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: "outputs/task04-report-mobile.png" });
  await page
    .getByRole("heading", { name: "Review findings", exact: true })
    .scrollIntoViewIfNeeded();
  expect(
    await page.getByLabel("Automated outcome", { exact: true }).count(),
  ).toBe(1);
  await context.close();
});
