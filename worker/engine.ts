import { destination, publicOrigin, PolicyError } from "./gateway/policy";
import type { GatewayResponse } from "./gateway/fetch";
import type { Browser, BrowserContext } from "playwright";
import type { Finding, ScanSettings } from "../src/features/scans/types";
import {
  fixtureUrl,
  sanitizeUrl,
  sanitizeText,
  failureCategory,
} from "./security";
export type ScanResult = {
  status: "completed" | "timed_out";
  checks: Finding[];
  artifacts: Partial<Record<"desktop" | "mobile", Buffer>>;
};
export async function disconnectBrowser(browser: Pick<Browser, "close">) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      browser.close(),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, 5000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
export function internalLinks(
  values: string[],
  base: string,
  authorize: (url: string) => unknown,
  limit: number,
) {
  const origin = new URL(base).origin;
  return [
    ...new Set(
      values.slice(0, 200).flatMap((value) => {
        try {
          const url = new URL(value, base);
          url.hash = "";
          if (url.origin !== origin) return [];
          authorize(url.href);
          return [url.href];
        } catch {
          return [];
        }
      }),
    ),
  ]
    .filter((value) => value !== base)
    .slice(0, Math.min(5, limit));
}
export async function scanWebsite(
  browser: Browser,
  target: string,
  settings: ScanSettings,
  testPolicy?: { authorize: (url: string) => unknown },
  publicTransport?: {
    fetch: (url: string, method: string) => Promise<GatewayResponse>;
  },
): Promise<ScanResult> {
  if (testPolicy && process.env.NODE_ENV !== "test")
    throw new Error("test_policy_forbidden");
  const publicMode = settings.mode === "public";
  if (publicMode && !publicTransport)
    throw new Error("public_gateway_required");
  if (!publicMode && publicTransport)
    throw new Error("unexpected_public_transport");
  const origin = publicMode ? publicOrigin(target).origin : "";
  const authorize = publicMode
    ? (url: string) => destination(url, origin, "GET")
    : (testPolicy?.authorize ?? fixtureUrl);
  const policyFailures: Array<{ url: string; code: string }> = [];
  let policyCount = 0;
  const blocked = (value: string, code: string) => {
    policyCount++;
    if (policyFailures.length < 20)
      policyFailures.push({ url: sanitizeUrl(value), code });
  };
  authorize(target);
  const checks: Finding[] = [];
  const artifacts: ScanResult["artifacts"] = {};
  const contexts: BrowserContext[] = [];
  const js: Array<{ source: string; message: string }> = [];
  const failed: Array<{ url: string; category: string; status?: number }> = [];
  let jsTotal = 0,
    failedTotal = 0,
    requests = 0,
    limited = false,
    cancelled = false;
  const finding = (
    type: Finding["check_type"],
    outcome: Finding["outcome"],
    description: string,
    details: Record<string, unknown>,
    started: number,
    screenshot_path: string | null = null,
  ) =>
    checks.push({
      check_type: type,
      outcome,
      description,
      details,
      duration_ms: Math.min(120000, Math.round(performance.now() - started)),
      screenshot_path,
    });
  const addFailure = (url: string, category: string, status?: number) => {
    failedTotal++;
    if (failed.length < 20)
      failed.push({
        url: sanitizeUrl(url),
        category,
        ...(status ? { status } : {}),
      });
  };
  async function context(
    viewport: { width: number; height: number },
    mobile: boolean,
  ) {
    if (cancelled) throw new Error("scan_cancelled");
    const ctx = await browser.newContext({
      viewport,
      isMobile: mobile,
      deviceScaleFactor: 1,
      acceptDownloads: false,
      serviceWorkers: "block",
      ignoreHTTPSErrors: false,
    });
    contexts.push(ctx);
    if (cancelled) {
      await ctx.close();
      throw new Error("scan_cancelled");
    }
    ctx.setDefaultTimeout(5000);
    ctx.setDefaultNavigationTimeout(15000);
    await ctx.route("**/*", async (route) => {
      try {
        if (++requests > settings.max_requests) {
          limited = true;
          throw new Error("request_limit");
        }
        authorize(route.request().url());
        if (publicTransport) {
          let prior = route.request().redirectedFrom(),
            hops = 0;
          while (prior) {
            if (++hops > 5) throw new PolicyError("redirect_limit");
            prior = prior.redirectedFrom();
          }
          const result = await publicTransport.fetch(
            route.request().url(),
            route.request().method(),
          );
          const body = Buffer.from(result.body, "base64");
          if (body.length > 2097152) throw new PolicyError("response_limit");
          await route.fulfill({
            status: result.status,
            headers: result.headers,
            body,
          });
        } else await route.continue();
      } catch (error) {
        if (publicMode)
          blocked(
            route.request().url(),
            error instanceof PolicyError ? error.code : "policy_rejected",
          );
        await route.abort("blockedbyclient");
      }
    });
    await ctx.routeWebSocket(/.*/, (socket) => {
      addFailure(socket.url(), "blocked");
      socket.close();
    });
    ctx.on("page", (page) => {
      if (ctx.pages().length > 1) void page.close();
    });
    const page = await ctx.newPage();
    page.on("pageerror", (error) => {
      jsTotal++;
      if (js.length < 20)
        js.push({
          source: "page-script (attribution unknown)",
          message: sanitizeText(error.message),
        });
    });
    page.on("console", (message) => {
      if (message.type() !== "error") return;
      jsTotal++;
      if (js.length < 20) {
        const location = message.location().url;
        let source = "unknown";
        try {
          source =
            new URL(location).origin === new URL(target).origin
              ? "first-party"
              : "third-party";
        } catch {}
        js.push({ source, message: sanitizeText(message.text()) });
      }
    });
    page.on("requestfailed", (request) =>
      addFailure(
        request.url(),
        failureCategory(request.failure()?.errorText ?? "network"),
      ),
    );
    page.on("response", (response) => {
      if (response.status() >= 400)
        addFailure(response.url(), "http", response.status());
    });
    return page;
  }
  const work = async () => {
    const desktop = await context({ width: 1440, height: 900 }, false);
    let started = performance.now();
    let loaded = false;
    let status: number | null = null;
    let finalUrl = sanitizeUrl(target);
    try {
      const response = await desktop.goto(target, {
        waitUntil: "domcontentloaded",
      });
      authorize(desktop.url());
      status = response?.status() ?? null;
      finalUrl = sanitizeUrl(desktop.url());
      loaded = true;
      finding(
        "availability",
        status !== null && status < 400 ? "pass" : "fail",
        "Navigation observed.",
        { http_status: status, final_url: finalUrl },
        started,
      );
    } catch (error) {
      finding(
        "availability",
        publicMode && policyCount ? "warning" : "fail",
        publicMode && policyCount
          ? "Navigation was blocked or could not be executed through the policy gateway."
          : "Navigation did not complete.",
        {
          executed: !(publicMode && policyCount),
          category:
            publicMode && policyCount
              ? "policy_blocked"
              : failureCategory(String(error)),
          final_url: sanitizeUrl(desktop.url()),
        },
        started,
      );
    }
    let links: string[] = [];
    if (loaded)
      links = internalLinks(
        await desktop
          .locator("a[href]")
          .evaluateAll((elements) =>
            elements
              .slice(0, 200)
              .map((element) => element.getAttribute("href") ?? ""),
          ),
        desktop.url(),
        authorize,
        settings.max_links,
      );
    for (const [type, viewport] of [
      ["desktop", { width: 1440, height: 900 }],
      ["mobile", { width: 390, height: 844 }],
    ] as const) {
      started = performance.now();
      try {
        if (publicMode && !loaded) {
          finding(
            type,
            "warning",
            "Screenshot not executed because target navigation was unavailable.",
            { executed: false, policy_blocked: policyCount > 0, viewport },
            started,
          );
          continue;
        }
        const page =
          type === "desktop" ? desktop : await context(viewport, true);
        if (type === "mobile") {
          await page.goto(target, { waitUntil: "domcontentloaded" });
          authorize(page.url());
        }
        const buffer = await page.screenshot({
          type: "png",
          fullPage: false,
          timeout: 5000,
          animations: "disabled",
        });
        if (
          buffer.length >
          (publicMode
            ? Math.min(2097152, settings.screenshot_bytes)
            : settings.screenshot_bytes)
        )
          finding(
            type,
            "warning",
            "Screenshot exceeded the artifact size limit.",
            { bytes: buffer.length, viewport },
            started,
          );
        else {
          artifacts[type] = buffer;
          finding(
            type,
            loaded ? "pass" : "warning",
            "Viewport screenshot captured; visual correctness is not assessed.",
            { bytes: buffer.length, viewport },
            started,
          );
        }
      } catch (error) {
        finding(
          type,
          "fail",
          "Viewport navigation or screenshot capture failed.",
          { category: failureCategory(String(error)), viewport },
          started,
        );
      }
    }
    started = performance.now();
    const observations: Array<{
      url: string;
      final_url?: string;
      status?: number;
      category?: string;
    }> = [];
    for (const link of links) {
      if (cancelled) throw new Error("scan_cancelled");
      try {
        const response = await desktop.goto(link, {
          waitUntil: "domcontentloaded",
          timeout: 5000,
        });
        authorize(desktop.url());
        observations.push({
          url: sanitizeUrl(link),
          final_url: sanitizeUrl(desktop.url()),
          status: response?.status() ?? 0,
        });
      } catch (error) {
        observations.push({
          url: sanitizeUrl(link),
          category: failureCategory(String(error)),
        });
      }
    }
    const broken = observations.filter((item) =>
      publicMode
        ? item.status !== undefined && item.status >= 400
        : !item.status || item.status >= 400,
    ).length;
    finding(
      "links",
      broken
        ? publicMode && observations.some((item) => item.category === "blocked")
          ? "warning"
          : "fail"
        : publicMode && observations.some((item) => !item.status)
          ? "warning"
          : observations.length
            ? "pass"
            : "warning",
      observations.length
        ? "Bounded internal-link navigation completed."
        : "No eligible internal links were observed.",
      {
        checked: observations.length,
        broken,
        links: observations,
        ...(publicMode
          ? {
              executed: loaded,
              executed_links: observations.filter(
                (item) => item.status !== undefined,
              ).length,
              not_executed_links: observations.filter(
                (item) => item.status === undefined,
              ).length,
            }
          : {}),
      },
      started,
    );
    finding(
      "javascript",
      publicMode && (!loaded || policyCount > 0)
        ? "warning"
        : jsTotal
          ? "warning"
          : "pass",
      publicMode && !loaded
        ? "JavaScript observation was not executed because target navigation was unavailable."
        : jsTotal
          ? "JavaScript or console errors were observed."
          : "No JavaScript or console errors were observed during this run.",
      {
        count: jsTotal,
        messages: js,
        truncated: jsTotal > js.length,
        ...(publicMode ? { executed: loaded } : {}),
      },
      performance.now(),
    );
    finding(
      "network",
      failedTotal || limited || policyCount ? "warning" : "pass",
      failedTotal || limited || policyCount
        ? "Failed or blocked requests were observed."
        : "No failed requests were observed during this run.",
      {
        count: failedTotal,
        policy_blocked: policyCount,
        policy_observations: policyFailures,
        transport: publicMode ? "pinned_gateway" : "fixture_network",
        requests,
        request_limit_reached: limited,
        failures: failed,
        truncated: failedTotal > failed.length,
      },
      performance.now(),
    );
    return { status: "completed" as const, checks, artifacts };
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work(),
      new Promise<ScanResult>((resolve) => {
        timer = setTimeout(
          () => {
            cancelled = true;
            resolve({
              status: "timed_out",
              checks: [...checks],
              artifacts: { ...artifacts },
            });
          },
          Math.min(90, settings.timeout_seconds) * 1000,
        );
      }),
    ]);
  } finally {
    cancelled = true;
    clearTimeout(timer);
    await Promise.race([
      Promise.allSettled(contexts.map((ctx) => ctx.close())),
      new Promise((resolve) => setTimeout(resolve, 2000)),
    ]);
  }
}
