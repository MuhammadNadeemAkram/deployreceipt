import { afterAll, beforeAll, it, expect } from "vitest";
import { chromium, type Browser } from "playwright";
import { fixtureServer } from "../../worker/fixtures/server.mjs";
import { scanWebsite } from "../../worker/engine";
import type { ScanSettings } from "../../src/features/scans/types";
const fixture = fixtureServer();
let browser: Browser;
let origin = "";
const settings = {
  singleton: true,
  mode: "local",
  daily_allowance: 10,
  cooldown_seconds: 60,
  timeout_seconds: 20,
  max_attempts: 3,
  max_links: 5,
  max_requests: 50,
  screenshot_bytes: 2097152,
  retention_days: 7,
} satisfies ScanSettings;
beforeAll(async () => {
  if (process.env.NODE_ENV !== "test")
    throw new Error("test_environment_required");
  await new Promise<void>((resolve) => fixture.listen(0, "127.0.0.1", resolve));
  const address = fixture.address();
  if (!address || typeof address === "string")
    throw new Error("fixture_failed");
  origin = `http://127.0.0.1:${address.port}`;
  browser = await chromium.launch({ headless: true });
});
afterAll(async () => {
  await browser?.close();
  fixture.closeAllConnections();
  await new Promise<void>((resolve) => fixture.close(() => resolve()));
});
const authorize = (value: string) => {
  const url = new URL(value);
  if (url.origin !== origin || url.username || url.password)
    throw new Error("blocked");
};
it("records six real checks, PNGs, JS errors, broken links, and blocked redirects", async () => {
  const result = await scanWebsite(browser, origin + "/", settings, {
    authorize,
  });
  expect(result.status).toBe("completed");
  expect(result.checks).toHaveLength(6);
  expect(result.artifacts.desktop?.subarray(0, 8).toString("hex")).toBe(
    "89504e470d0a1a0a",
  );
  expect(result.artifacts.mobile?.length).toBeGreaterThan(100);
  expect(
    result.checks.find((item) => item.check_type === "availability")?.details
      .http_status,
  ).toBe(200);
  expect(
    result.checks.find((item) => item.check_type === "links")?.details.broken,
  ).toBeGreaterThan(0);
  expect(
    result.checks.find((item) => item.check_type === "javascript")?.details
      .count,
  ).toBeGreaterThan(0);
  expect(JSON.stringify(result.checks)).not.toContain("do-not-store");
  expect(
    result.checks.find((item) => item.check_type === "network")?.details.count,
  ).toBeGreaterThan(0);
});
it("enforces the whole-scan deadline and closes contexts", async () => {
  const result = await scanWebsite(
    browser,
    origin + "/slow",
    { ...settings, timeout_seconds: 1 },
    { authorize },
  );
  expect(result.status).toBe("timed_out");
  expect(browser.contexts()).toHaveLength(0);
});
it("rejects a metadata redirect instead of allowing it to bypass route policy", async () => {
  const result = await scanWebsite(
    browser,
    origin + "/redirect-private",
    settings,
    { authorize },
  );
  expect(
    result.checks.find((item) => item.check_type === "availability")?.outcome,
  ).toBe("fail");
});
