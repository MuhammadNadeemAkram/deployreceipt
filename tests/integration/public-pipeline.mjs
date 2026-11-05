// Real owner-authorized public test, explicitly dispatched after isolated security tests.
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { randomUUID, randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolveTxt } from "node:dns/promises";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { chromium } from "playwright";
import { PDFDocument, PDFName } from "pdf-lib";
if (
  process.env.CI !== "true" ||
  process.env.NODE_ENV !== "test" ||
  process.env.PUBLIC_SCAN_AUTHORIZATION !== "www.noviqen.co.uk" ||
  process.env.PUBLIC_SECURITY_PROBES_PASSED !== "1"
)
  throw Error("Approved disposable public staging test required");
const target = "https://www.noviqen.co.uk/",
  challenge = process.env.PUBLIC_SCAN_E2E_CHALLENGE,
  sha = process.env.GITHUB_SHA;
if (
  !challenge ||
  !/^[a-f0-9]{64}$/.test(challenge) ||
  !sha ||
  !/^[a-f0-9]{40}$/.test(sha)
)
  throw Error(
    "BLOCKED: private DNS challenge or verified revision unavailable",
  );
let dnsMatches = false;
try {
  dnsMatches = (await resolveTxt("_deployreceipt.www.noviqen.co.uk")).some(
    (parts) => parts.join("") === "deployreceipt=" + challenge,
  );
} catch {}
if (!dnsMatches)
  throw Error(
    "BLOCKED: actual DNS ownership proof not yet available; no public scan started",
  );
const status = JSON.parse(
  execFileSync("supabase", ["status", "--output", "json"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }),
);
const values = Object.fromEntries(
  Object.entries(status).map(([k, v]) => [
    k.toUpperCase().replace(/[^A-Z0-9]/g, ""),
    v,
  ]),
);
const api = String(values.APIURL),
  key = String(values.PUBLISHABLEKEY),
  secret = String(values.SECRETKEY),
  parsed = new URL(api);
assert(
  ["127.0.0.1", "localhost"].includes(parsed.hostname) &&
    parsed.protocol === "http:",
  "Disposable local database only",
);
assert(key.startsWith("sb_publishable_") && secret.startsWith("sb_secret_"));
const admin = createClient(api, secret, {
    auth: { persistSession: false, autoRefreshToken: false },
  }),
  users = [],
  site = "http://127.0.0.1:3121";
const compose = [
  "compose",
  "--env-file",
  ".env.public-worker",
  "-f",
  "compose.scan-public.yml",
];
let browser, app, projectId, scanId;
const checked = (result, label) => {
  if (result.error)
    throw Error(label + ":" + (result.error.code ?? "dependency_error"));
  return result.data;
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(read, accept, label, ms = 180000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const value = await read();
    if (accept(value)) return value;
    await sleep(1500);
  }
  throw Error("Timeout: " + label);
}
async function command(program, args, env = process.env) {
  await new Promise((resolve, reject) => {
    const p = spawn(program, args, { env, stdio: "inherit" });
    p.on("error", reject);
    p.on("exit", (code) =>
      code === 0 ? resolve() : reject(Error("Staging command failed")),
    );
  });
}
async function account(worker = false) {
  const email = "public-e2e-" + randomUUID() + "@example.test",
    password = randomBytes(24).toString("base64url") + "Aa1!";
  checked(
    await admin.from("beta_access").insert({ email }),
    "operator admission",
  );
  const user = checked(
    await admin.auth.admin.createUser({ email, password, email_confirm: true }),
    "admitted account",
  ).user;
  users.push({ id: user.id, email });
  if (worker)
    checked(
      await admin
        .from("scan_worker_identities")
        .insert({ user_id: user.id, active: true }),
      "dedicated controller identity",
    );
  const jar = new Map();
  const client = createServerClient(api, key, {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (entries) =>
        entries.forEach(({ name, value }) =>
          value ? jar.set(name, value) : jar.delete(name),
        ),
    },
  });
  checked(
    await client.auth.signInWithPassword({ email, password }),
    "real authentication",
  );
  if (worker) {
    const result = checked(await client.auth.getClaims(), "worker JWT");
    assert.equal(result.claims.role, "deployreceipt_scan_worker");
  }
  return {
    user,
    email,
    password,
    client,
    jar,
    cookie: () =>
      [...jar].map(([n, v]) => n + "=" + encodeURIComponent(v)).join("; "),
  };
}
try {
  await mkdir("outputs", { recursive: true });
  checked(
    await admin
      .from("beta_settings")
      .update({
        environment: "staging",
        enforced: true,
        scanning_enabled: true,
      })
      .eq("singleton", true),
    "staging environment",
  );
  checked(
    await admin
      .from("scan_settings")
      .update({
        mode: "disabled",
        max_links: 1,
        max_requests: 100,
        timeout_seconds: 90,
      })
      .eq("singleton", true),
    "bounded public staging mode",
  );
  checked(
    await admin
      .from("public_scan_settings")
      .update({
        operator_enabled: true,
        staging_approved: true,
        production_enabled: false,
        infrastructure_checked_at: new Date().toISOString(),
        security_suite_sha: sha,
      })
      .eq("singleton", true),
    "verified staging infrastructure gate",
  );
  const owner = await account(),
    reviewer = await account(),
    outsider = await account(),
    worker = await account(true);
  const project = checked(
    await owner.client
      .from("projects")
      .insert({
        name: "Noviqen authorized public staging",
        website_url: target,
      })
      .select("*")
      .single(),
    "create owner project",
  );
  projectId = project.id;
  checked(
    await owner.client.rpc("request_domain_verification", {
      p_project_id: project.id,
    }),
    "queue actual DNS challenge",
  );
  checked(
    await admin
      .from("domain_verifications")
      .update({ token: challenge })
      .eq("project_id", project.id),
    "bind previously issued owner challenge before worker starts",
  );
  checked(
    await admin
      .from("scan_settings")
      .update({ mode: "public" })
      .eq("singleton", true),
    "enable tested staging public controller",
  );
  const controllerKey = randomBytes(32).toString("hex");
  await writeFile(
    ".env.public-worker",
    `SUPABASE_URL=http://host.docker.internal:${parsed.port}\nSUPABASE_PUBLISHABLE_KEY=${key}\nWORKER_EMAIL=${worker.email}\nWORKER_PASSWORD=${worker.password}\nGATEWAY_CONTROL_KEY=${controllerKey}\nPUBLIC_SCAN_CODE_SHA=${sha}\nSCAN_WORKER_MODE=public\nAPP_ENV=staging\nPUBLIC_SCAN_STAGING=approved\n`,
    { mode: 0o600 },
  );
  await command("docker", [...compose, "up", "--build", "-d"]);
  await until(
    async () =>
      checked(
        await owner.client.rpc("public_scanning_status", {}),
        "security readiness",
      ),
    Boolean,
    "independent public worker/gateway readiness",
  );
  const verification = await until(
    async () =>
      checked(
        await owner.client
          .from("domain_verifications")
          .select("*")
          .eq("project_id", project.id)
          .single(),
        "verification state",
      ),
    (v) => v.status === "verified",
    "real DNS ownership verification",
  );
  assert.equal(verification.method, "dns");
  assert(verification.expires_at);
  scanId = checked(
    await owner.client.rpc("request_public_scan", {
      p_project_id: project.id,
      p_consent: true,
    }),
    "consented public scan submission",
  );
  const run = await until(
    async () =>
      checked(
        await owner.client
          .from("scan_runs")
          .select("*")
          .eq("id", scanId)
          .single(),
        "persisted run",
      ),
    (r) => ["completed", "failed", "timed_out"].includes(r.status),
    "real public scan",
    300000,
  );
  assert.equal(
    run.status,
    "completed",
    "Real public scan must finish; no mocked or substituted result",
  );
  assert.equal(run.configuration_snapshot.mode, "public");
  assert.equal(run.configuration_snapshot.transport, "pinned_gateway_v1");
  assert.equal(run.verification_snapshot.method, "dns");
  const checks = checked(
    await owner.client
      .from("scan_checks")
      .select("*")
      .eq("scan_run_id", scanId),
    "actual public findings",
  );
  assert.equal(checks.length, 6);
  const availability = checks.find((c) => c.check_type === "availability");
  assert.equal(
    typeof availability.details.http_status,
    "number",
    "Actual target HTTP response required",
  );
  const images = checks.filter((c) => c.screenshot_path);
  assert.equal(images.length, 2, "Actual desktop and mobile evidence required");
  for (const image of images) {
    const blob = checked(
      await owner.client.storage
        .from("scan-artifacts")
        .download(image.screenshot_path),
      "private owner PNG",
    );
    const bytes = Buffer.from(await blob.arrayBuffer());
    assert(bytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex")));
    assert(
      (
        await outsider.client.storage
          .from("scan-artifacts")
          .download(image.screenshot_path)
      ).error,
    );
  }
  const reportId = checked(
    await owner.client.rpc("create_qa_report", { p_scan_id: scanId }),
    "report from actual records",
  );
  const env = {
    ...process.env,
    NODE_ENV: "production",
    APP_ENV: "local",
    SCANNING_AVAILABLE: "disabled",
    NEXT_PUBLIC_SUPABASE_URL: api,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: key,
    NEXT_PUBLIC_SITE_URL: site,
    NEXT_TELEMETRY_DISABLED: "1",
  };
  // Local reporting UI is not a deployed public scanner. Public execution above is gated in the staging database/controller.
  await command(
    process.execPath,
    ["node_modules/next/dist/bin/next", "build", "--webpack"],
    env,
  );
  app = spawn(
    process.execPath,
    [
      "node_modules/next/dist/bin/next",
      "start",
      "--hostname",
      "127.0.0.1",
      "--port",
      "3121",
    ],
    { env, stdio: "inherit" },
  );
  await until(
    async () => {
      try {
        return (await fetch(site)).status;
      } catch {
        return 0;
      }
    },
    (v) => v === 200,
    "reporting UI",
  );
  const pdfResponse = await fetch(site + "/api/reports/" + reportId + "/pdf", {
    method: "POST",
    headers: { Cookie: owner.cookie(), Origin: site },
    redirect: "manual",
  });
  assert.equal(pdfResponse.status, 200);
  const pdfBytes = new Uint8Array(await pdfResponse.arrayBuffer()),
    pdf = await PDFDocument.load(pdfBytes);
  assert(
    pdf
      .getPages()
      .some((p) => p.node.Resources()?.lookup(PDFName.of("XObject"))),
  );
  await writeFile("outputs/public-e2e-report.pdf", pdfBytes);
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
      .getByRole("heading", { name: project.name, exact: true })
      .waitFor();
    await page
      .getByText(/Authorized public scan: exact verified origin/)
      .waitFor();
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    await page.screenshot({
      path: "outputs/public-e2e-report-" + label + ".png",
    });
    await context.close();
  }
  const reviewId = checked(
    await owner.client.rpc("create_release_review", {
      p_report: reportId,
      p_title: "Noviqen actual public scan review",
      p_notes:
        "Authorized staging QA observations only. Policy limitations and GET side effects acknowledged; no security certification or deployment is implied.",
      p_email: reviewer.email,
      p_previous: null,
    }),
    "freeze real public report",
  );
  checked(
    await owner.client.rpc("manage_release_review", {
      p_id: reviewId,
      p_action: "submit",
    }),
    "submit review",
  );
  const invitation = checked(
    await owner.client
      .from("review_invitations")
      .select("id")
      .eq("review_id", reviewId)
      .eq("status", "pending")
      .single(),
    "review invitation",
  );
  checked(
    await reviewer.client.rpc("accept_review_invitation", {
      p_invitation: invitation.id,
    }),
    "verified reviewer acceptance",
  );
  const frozen = checked(
    await reviewer.client
      .from("release_reviews")
      .select("*")
      .eq("id", reviewId)
      .single(),
    "reviewer snapshot",
  );
  assert.equal(frozen.snapshot.configuration.mode, "public");
  assert.equal(frozen.snapshot.target_url, target);
  assert.equal(
    checked(
      await outsider.client
        .from("release_reviews")
        .select("id")
        .eq("id", reviewId),
      "third-party denial",
    ).length,
    0,
  );
  const reviewerContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  await reviewerContext.addCookies(
    [...reviewer.jar].map(([name, value]) => ({ name, value, url: site })),
  );
  const reviewPage = await reviewerContext.newPage();
  await reviewPage.goto(site + "/reviews/" + reviewId);
  await reviewPage
    .getByRole("heading", {
      name: "Noviqen actual public scan review",
      exact: true,
    })
    .waitFor();
  await reviewPage.screenshot({ path: "outputs/public-e2e-review-mobile.png" });
  await reviewerContext.close();
  const evidence = await fetch(
    site + "/api/reviews/" + reviewId + "/evidence/" + images[0].id,
    { headers: { Cookie: reviewer.cookie() }, redirect: "manual" },
  );
  assert.equal(evidence.status, 200);
  assert(evidence.headers.get("content-type")?.includes("image/png"));
  checked(
    await reviewer.client.rpc("decide_release_review", {
      p_id: reviewId,
      p_version: frozen.version,
      p_digest: frozen.snapshot_digest,
      p_decision: "approved",
      p_scope_ack: true,
      p_observations_ack: true,
      p_evidence_ack: true,
      p_notes:
        "Accept this recorded QA evidence and its explicit coverage limitations for the controlled staging exercise.",
    }),
    "version-bound reviewer decision",
  );
  checked(
    await admin
      .from("public_scan_settings")
      .update({ operator_enabled: false })
      .eq("singleton", true),
    "emergency submission pause",
  );
  assert.equal(
    checked(
      await owner.client.rpc("public_scanning_status", {}),
      "paused readiness",
    ),
    false,
  );
  checked(
    await owner.client.from("projects").delete().eq("id", project.id),
    "cleanup project",
  );
  assert.equal(
    (
      await fetch(site + "/api/reviews/" + reviewId, {
        headers: { Cookie: reviewer.cookie() },
        redirect: "manual",
      })
    ).status,
    404,
  );
  await writeFile(
    "outputs/public-e2e-proof.json",
    JSON.stringify(
      {
        environment:
          "disposable approved Linux staging runner; real owner-authorized public target; local reporting UI",
        target_origin: new URL(target).origin,
        commit: sha,
        real_dns_ownership: true,
        least_privilege_worker: true,
        actual_executed_checks: checks.length,
        http_status: availability.details.http_status,
        passed: run.passed_count,
        failed: run.failed_count,
        warnings: run.warning_count,
        policy_blocked: checks.find((c) => c.check_type === "network").details
          .policy_blocked,
        screenshots: images.length,
        pdf_bytes: pdfBytes.length,
        pdf_pages: pdf.getPageCount(),
        reviewer_access: true,
        version_bound_approval: true,
        cross_user_denial: true,
        kill_switch_verified: true,
        cleanup_revokes_access: true,
        production_activated: false,
      },
      null,
      2,
    ),
  );
  console.info(
    JSON.stringify({
      event: "authorized_public_staging_e2e_passed",
      checks: checks.length,
      screenshots: images.length,
    }),
  );
} finally {
  await admin
    .from("public_scan_settings")
    .update({ operator_enabled: false })
    .eq("singleton", true);
  await browser?.close();
  app?.kill("SIGTERM");
  try {
    execFileSync(
      "docker",
      [
        ...compose,
        "logs",
        "--tail",
        "60",
        "public-worker",
        "public-gateway",
        "public-browser",
      ],
      { stdio: "inherit" },
    );
  } catch {}
  try {
    execFileSync("docker", [...compose, "down"], { stdio: "inherit" });
  } catch {}
  if (projectId) await admin.from("projects").delete().eq("id", projectId);
  for (const user of users) {
    await admin.auth.admin.deleteUser(user.id);
    await admin.from("beta_access").delete().eq("email", user.email);
  }
}
