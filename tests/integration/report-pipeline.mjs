import { verifyReleaseWorkflow } from "./release-workflow.mjs";
// Disposable local-stack CI integration only. Never points at a hosted Supabase project.
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { chromium } from "playwright";
import { PDFDocument, PDFName } from "pdf-lib";
if (process.env.CI !== "true" || process.env.NODE_ENV !== "test")
  throw new Error("Disposable CI test environment required");
const raw = JSON.parse(
  execFileSync("supabase", ["status", "--output", "json"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }),
);
const status = Object.fromEntries(
  Object.entries(raw).map(([key, value]) => [
    key.toUpperCase().replace(/[^A-Z0-9]/g, ""),
    value,
  ]),
);
const api = String(status.APIURL ?? "");
const apiUrl = new URL(api);
assert(
  ["localhost", "127.0.0.1"].includes(apiUrl.hostname) &&
    apiUrl.protocol === "http:",
  "Only local Supabase is allowed",
);
const publishable = String(status.PUBLISHABLEKEY ?? "");
const secret = String(status.SECRETKEY ?? "");
assert(
  publishable.startsWith("sb_publishable_") && secret.startsWith("sb_secret_"),
  "Current local publishable/secret keys required",
);
const admin = createClient(api, secret, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const site = "http://127.0.0.1:3120",
  users = [];
let app, browser;
const compose = ["compose", "-f", "compose.scan-local.yml"];
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function checked(result, label) {
  if (result.error)
    throw new Error(
      label +
        ": " +
        String(result.error.code ?? result.error.status ?? "service_error"),
    );
  return result.data;
}
function command(program, args, env = process.env) {
  return new Promise((resolve, reject) => {
    const child = spawn(program, args, { env, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0 ? resolve() : reject(new Error("Command failed: " + args[0])),
    );
  });
}
async function until(read, predicate, label, timeout = 240000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const value = await read();
    if (predicate(value)) return value;
    await pause(1000);
  }
  throw new Error("Timed out: " + label);
}
function session() {
  const jar = new Map();
  const client = createServerClient(api, publishable, {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (values) =>
        values.forEach(({ name, value }) =>
          value ? jar.set(name, value) : jar.delete(name),
        ),
    },
  });
  return {
    client,
    jar,
    cookie: () =>
      [...jar]
        .map(([name, value]) => name + "=" + encodeURIComponent(value))
        .join("; "),
  };
}
async function account() {
  const email = "e2e-" + randomUUID() + "@example.test",
    password = randomBytes(24).toString("base64url") + "Aa1!";
  const data = checked(
    await admin.auth.admin.createUser({ email, password, email_confirm: true }),
    "create test user",
  );
  users.push(data.user.id);
  const owner = session();
  checked(
    await owner.client.auth.signInWithPassword({ email, password }),
    "real password login",
  );
  return owner;
}
try {
  await mkdir("outputs", { recursive: true });
  await mkdir("work", { recursive: true });
  checked(
    await admin
      .from("scan_settings")
      .update({ mode: "local" })
      .eq("singleton", true),
    "enable fixture only",
  );
  await writeFile(
    ".env.worker",
    "SUPABASE_URL=http://host.docker.internal:" +
      apiUrl.port +
      "\nSUPABASE_SECRET_KEY=" +
      secret +
      "\nSCAN_WORKER_MODE=local\n",
    { mode: 0o600 },
  );
  await command("docker", [
    ...compose,
    "up",
    "--build",
    "-d",
    "fixture",
    "browser",
  ]);
  await until(
    async () =>
      execFileSync("docker", [...compose, "logs", "browser"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }),
    (logs) => logs.includes("Restricted fixture browser ready"),
    "sandboxed browser readiness",
    90000,
  );
  await command("docker", [...compose, "up", "--build", "-d", "worker"]);
  const owner = await account(),
    other = await account();
  const project = checked(
    await owner.client
      .from("projects")
      .insert({
        name: "Controlled fixture E2E",
        website_url: "http://fixture:8080/",
      })
      .select("*")
      .single(),
    "create project",
  );
  checked(
    await owner.client.rpc("request_domain_verification", {
      p_project_id: project.id,
    }),
    "request fixture authorization",
  );
  const verification = await until(
    async () =>
      checked(
        await owner.client
          .from("domain_verifications")
          .select("*")
          .eq("project_id", project.id)
          .single(),
        "read verification",
      ),
    (value) => value.status === "verified",
    "fixture verification",
    90000,
  );
  assert.equal(verification.method, "local_fixture");
  const scanId = checked(
    await owner.client.rpc("request_scan", { p_project_id: project.id }),
    "enqueue scan",
  );
  const run = await until(
    async () =>
      checked(
        await owner.client
          .from("scan_runs")
          .select("*")
          .eq("id", scanId)
          .single(),
        "read scan",
      ),
    (value) => ["completed", "failed", "timed_out"].includes(value.status),
    "scan persistence",
  );
  assert.equal(run.status, "completed", "Real isolated scan must complete");
  assert.equal(run.configuration_snapshot?.source, "worker_attempt");
  const checks = checked(
    await owner.client
      .from("scan_checks")
      .select("*")
      .eq("scan_run_id", scanId),
    "read real checks",
  );
  assert.equal(checks.length, 6);
  const observation = (type) =>
    checks.find((check) => check.check_type === type);
  assert.equal(observation("availability")?.outcome, "pass");
  assert.equal(observation("availability")?.details.http_status, 200);
  assert.equal(
    observation("availability")?.details.final_url,
    "http://fixture:8080/",
  );
  for (const type of ["desktop", "mobile"])
    assert.equal(
      observation(type)?.outcome,
      "pass",
      "Fixture viewport must load",
    );
  assert(
    observation("javascript")?.details.count > 0,
    "Fixture JS errors must be observed",
  );
  assert(
    observation("links")?.details.broken > 0,
    "Fixture broken link must be observed",
  );
  assert(
    observation("network")?.details.count > 0,
    "Fixture resource failures must be observed",
  );
  assert(
    !JSON.stringify(checks).includes("do-not-store"),
    "Fixture token must be redacted",
  );
  const screenshots = checks.filter((check) => check.screenshot_path);
  assert.equal(screenshots.length, 2);
  const screenshotBytes = [];
  for (const check of screenshots) {
    const blob = checked(
      await owner.client.storage
        .from("scan-artifacts")
        .download(check.screenshot_path),
      "read private screenshot",
    );
    const bytes = new Uint8Array(await blob.arrayBuffer());
    assert(
      Buffer.from(bytes.subarray(0, 8)).equals(
        Buffer.from("89504e470d0a1a0a", "hex"),
      ),
    );
    screenshotBytes.push(bytes.length);
  }
  const reportId = checked(
    await owner.client.rpc("create_qa_report", { p_scan_id: scanId }),
    "create report from real run",
  );
  const target = checks.find((check) => check.check_type === "links");
  assert(target);
  const originalOutcome = target.outcome;
  checked(
    await owner.client.rpc("save_qa_triage", {
      p_report_id: reportId,
      p_check_id: target.id,
      p_severity: "medium",
      p_resolution: "investigating",
      p_notes: "Controlled fixture investigation; automated outcome retained.",
      p_revision: 1,
      p_evidence: [screenshots[0].id],
    }),
    "save real triage",
  );
  checked(
    await owner.client.rpc("add_qa_comment", {
      p_report_id: reportId,
      p_check_id: target.id,
      p_body: "Checked during the disposable end-to-end test.",
    }),
    "add comment",
  );
  const unchanged = checked(
    await owner.client
      .from("scan_checks")
      .select("outcome")
      .eq("id", target.id)
      .single(),
    "read immutable outcome",
  );
  assert.equal(unchanged.outcome, originalOutcome);
  const foreign = checked(
    await other.client.from("qa_reports").select("id").eq("id", reportId),
    "cross-user report query",
  );
  assert.equal(foreign.length, 0);
  const foreignImage = await other.client.storage
    .from("scan-artifacts")
    .download(screenshots[0].screenshot_path);
  assert(foreignImage.error, "Other user must not download evidence");
  const appEnv = {
    ...process.env,
    NODE_ENV: "production",
    NEXT_TELEMETRY_DISABLED: "1",
    NEXT_PUBLIC_SUPABASE_URL: api,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: publishable,
    NEXT_PUBLIC_SITE_URL: site,
  };
  await command(
    process.execPath,
    ["node_modules/next/dist/bin/next", "build", "--webpack"],
    appEnv,
  );
  app = spawn(
    process.execPath,
    [
      "node_modules/next/dist/bin/next",
      "start",
      "--hostname",
      "127.0.0.1",
      "--port",
      "3120",
    ],
    { env: appEnv, stdio: "inherit" },
  );
  await until(
    async () => {
      try {
        return (await fetch(site)).status;
      } catch {
        return 0;
      }
    },
    (code) => code === 200,
    "web readiness",
    30000,
  );
  const reportResponse = await fetch(site + "/api/reports/" + reportId, {
    headers: { Cookie: owner.cookie() },
    redirect: "manual",
  });
  assert.equal(reportResponse.status, 200);
  const model = await reportResponse.json();
  assert.equal(model.findings.length, 6);
  assert.equal(model.report.scan_run_id, scanId);
  assert.equal(
    model.findings.find((item) => item.check.id === target.id).triage.severity,
    "medium",
  );
  const denied = await fetch(site + "/api/reports/" + reportId, {
    headers: { Cookie: other.cookie() },
    redirect: "manual",
  });
  assert.equal(denied.status, 404);
  const pdfResponse = await fetch(site + "/api/reports/" + reportId + "/pdf", {
    method: "POST",
    headers: { Cookie: owner.cookie(), Origin: site },
    redirect: "manual",
  });
  assert.equal(pdfResponse.status, 200, "Authenticated PDF must render");
  assert(pdfResponse.headers.get("content-type")?.includes("application/pdf"));
  const pdfBytes = new Uint8Array(await pdfResponse.arrayBuffer());
  const pdf = await PDFDocument.load(pdfBytes);
  assert(pdf.getPageCount() > 2);
  assert(
    pdf
      .getPages()
      .some((page) => page.node.Resources()?.lookup(PDFName.of("XObject"))),
  );
  await writeFile("outputs/e2e-report.pdf", pdfBytes);
  browser = await chromium.launch({ headless: true });
  for (const [label, viewport] of [
    ["desktop", { width: 1440, height: 1000 }],
    ["mobile", { width: 390, height: 844 }],
  ]) {
    const context = await browser.newContext({ viewport });
    await context.addCookies(
      [...owner.jar].map(([name, value]) => ({ name, value, url: site })),
    );
    const page = await context.newPage();
    await page.goto(site + "/dashboard/reports/" + reportId);
    await page
      .getByRole("heading", { name: "Controlled fixture E2E", exact: true })
      .waitFor();
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    await page.screenshot({ path: "outputs/e2e-report-" + label + ".png" });
    await page
      .getByRole("heading", { name: "Review findings", exact: true })
      .scrollIntoViewIfNeeded();
    if (label === "desktop")
      await page.screenshot({ path: "outputs/e2e-findings-desktop.png" });
    await context.close();
  }
  const releaseProof = await verifyReleaseWorkflow({
    owner,
    reviewer: other,
    outsider: await account(),
    reportId,
    checks,
    browser,
    site,
    admin,
  });
  checked(
    await owner.client.from("projects").delete().eq("id", project.id),
    "delete disposable project",
  );
  const deleted = await fetch(site + "/api/reports/" + reportId, {
    headers: { Cookie: owner.cookie() },
    redirect: "manual",
  });
  assert.equal(deleted.status, 404);
  const deletedExport = await fetch(
    site + "/api/reports/" + reportId + "/pdf",
    {
      method: "POST",
      headers: { Cookie: owner.cookie(), Origin: site },
      redirect: "manual",
    },
  );
  assert.equal(deletedExport.status, 404);
  for (const reviewId of releaseProof.reviewIds) {
    const response = await fetch(site + "/api/reviews/" + reviewId, {
      headers: { Cookie: other.cookie() },
      redirect: "manual",
    });
    assert.equal(response.status, 404);
  }
  const proof = {
    environment: "disposable local CI Supabase and isolated fixture containers",
    generated_at: new Date().toISOString(),
    scan_id: scanId,
    report_id: reportId,
    scan_status: run.status,
    configuration_recorded: run.configuration_snapshot?.source,
    checks: checks.length,
    observed_http_status: observation("availability").details.http_status,
    observed_broken_links: observation("links").details.broken,
    observed_javascript_errors: observation("javascript").details.count,
    passed: run.passed_count,
    failed: run.failed_count,
    warnings: run.warning_count,
    screenshot_bytes: screenshotBytes,
    pdf_bytes: pdfBytes.length,
    pdf_pages: pdf.getPageCount(),
    real_login: true,
    owner_access: true,
    cross_user_denied: true,
    manual_outcome_preserved: true,
    project_deletion_revokes_access: true,
    public_scanning_enabled: false,
  };
  await writeFile("outputs/e2e-proof.json", JSON.stringify(proof, null, 2));
  console.info(
    "Controlled end-to-end scan/report/PDF passed",
    scanId,
    reportId,
  );
} finally {
  await browser?.close();
  app?.kill("SIGTERM");
  try {
    execFileSync(
      "docker",
      [...compose, "logs", "--tail", "80", "worker", "browser"],
      { stdio: "inherit" },
    );
  } catch {}
  try {
    execFileSync("docker", [...compose, "down"], { stdio: "inherit" });
  } catch {}
  for (const id of users) {
    try {
      await admin.auth.admin.deleteUser(id);
    } catch {}
  }
}
