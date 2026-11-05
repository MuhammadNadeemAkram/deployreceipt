import { beforeAll, afterAll, it, expect } from "vitest";
import { chromium, type Browser } from "playwright";
import { scanWebsite } from "../../worker/engine";
import { FetchScope } from "../../worker/gateway/fetch";
import { PolicyError } from "../../worker/gateway/policy";
import type { ScanSettings } from "../../src/features/scans/types";
let browser: Browser;
const origin = "https://owned.qa-fixture.net";
const settings = {
  singleton: true,
  mode: "public",
  daily_allowance: 10,
  cooldown_seconds: 60,
  timeout_seconds: 15,
  max_attempts: 3,
  max_links: 1,
  max_requests: 30,
  screenshot_bytes: 2097152,
  retention_days: 7,
} satisfies ScanSettings;
beforeAll(async () => {
  browser = await chromium.launch({
    headless: true,
    args: [
      "--proxy-server=http://127.0.0.1:9",
      "--proxy-bypass-list=<-loopback>",
    ],
  });
});
afterAll(async () => {
  await browser?.close();
});
it("renders controlled gateway bytes and records policy coverage without forwarding POST or third parties", async () => {
  const methods: string[] = [];
  const gateway = new FetchScope(
    origin,
    { requests: 30, seconds: 20 },
    async () => [{ address: "93.184.215.15", family: 4 }],
    async (input) => {
      methods.push(input.method);
      const html = `<!doctype html><h1>Controlled gateway browser fixture</h1><a href="/linked">Internal link</a><script>fetch('/mutate',{method:'POST'}).catch(()=>{});fetch('http://169.254.169.254/').catch(()=>{});console.error('controlled observation');</script>`;
      const bytes = Buffer.from(html);
      input.consume(bytes.length);
      return { status: 200, headers: { "content-type": "text/html" }, bytes };
    },
  );
  const result = await scanWebsite(
    browser,
    origin + "/",
    settings,
    undefined,
    gateway,
  );
  gateway.close();
  expect(result.status).toBe("completed");
  expect(result.checks).toHaveLength(6);
  expect(result.artifacts.desktop?.length).toBeGreaterThan(100);
  expect(result.artifacts.mobile?.length).toBeGreaterThan(100);
  expect(methods.length).toBeGreaterThan(1);
  expect(methods.every((m) => m === "GET")).toBe(true);
  const network = result.checks.find((c) => c.check_type === "network")!;
  expect(network.outcome).toBe("warning");
  expect(network.details.policy_blocked).toBeGreaterThan(0);
  expect(network.details.transport).toBe("pinned_gateway");
  expect(
    result.checks.find((c) => c.check_type === "javascript")?.outcome,
  ).toBe("warning");
  expect(browser.contexts()).toHaveLength(0);
});
it("marks blocked navigation and unexecuted observations as warnings, never fictional successful checks", async () => {
  const result = await scanWebsite(browser, origin + "/", settings, undefined, {
    fetch: async () => {
      throw new PolicyError("dns_answers_rejected");
    },
  });
  for (const type of [
    "availability",
    "desktop",
    "mobile",
    "javascript",
    "links",
  ]) {
    const check = result.checks.find((c) => c.check_type === type)!;
    expect(check.outcome).toBe("warning");
    expect(check.details.executed).toBe(false);
  }
  expect(Object.keys(result.artifacts)).toHaveLength(0);
  expect(browser.contexts()).toHaveLength(0);
});
