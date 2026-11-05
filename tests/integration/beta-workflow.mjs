import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { writeFile } from "node:fs/promises";
export async function verifyBeta({
  admin,
  owner,
  reviewer,
  reviewIds,
  reportId,
  checks,
  browser,
  site,
  api,
  publishable,
}) {
  const checked = (r, label) => {
    if (r.error)
      throw Error(label + ":" + (r.error.code ?? "dependency_error"));
    return r.data;
  };
  assert.equal((await fetch(site + "/api/health")).status, 200);
  assert.equal((await fetch(site + "/api/ready")).status, 200);
  // Exercise server-side operator invitation onboarding without sending mail or logging tokens.
  const invitedEmail = "invited-" + randomUUID() + "@example.test";
  checked(
    await admin.from("beta_access").insert({ email: invitedEmail }),
    "admit invitation recipient",
  );
  const invitation = checked(
    await admin.auth.admin.generateLink({
      type: "invite",
      email: invitedEmail,
    }),
    "generate operator invitation",
  );
  const inviteContext = await browser.newContext();
  try {
    const callback = await inviteContext.request
      .get(
        site +
          "/auth/callback?type=invite&token_hash=" +
          encodeURIComponent(invitation.properties.hashed_token),
        { maxRedirects: 0 },
      )
      .catch(() => {
        throw Error("Operator invitation callback unavailable");
      });
    assert.equal(callback.status(), 303);
    assert.equal(
      new URL(callback.headers().location, site).pathname,
      "/reset-password",
    );
    const invitePage = await inviteContext.newPage();
    await invitePage.goto(site + "/reset-password");
    const password = randomBytes(24).toString("base64url") + "Aa1!";
    await invitePage.getByLabel("New password", { exact: true }).fill(password);
    await invitePage
      .getByLabel("Confirm password", { exact: true })
      .fill(password);
    await invitePage
      .getByRole("button", { name: "Set new password", exact: true })
      .click();
    await invitePage.waitForURL(site + "/login?notice=password-updated");
    await invitePage
      .getByLabel("Email address", { exact: true })
      .fill(invitedEmail);
    await invitePage.getByLabel("Password", { exact: true }).fill(password);
    await invitePage
      .getByRole("button", { name: "Sign in", exact: true })
      .click();
    await invitePage.waitForURL(site + "/dashboard");
    await invitePage
      .getByRole("heading", { name: "Your websites, organized." })
      .waitFor();
  } finally {
    await inviteContext.close();
    await admin.auth.admin.deleteUser(invitation.user.id);
    await admin.from("beta_access").delete().eq("email", invitedEmail);
  }
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  context.setDefaultTimeout(20000);
  const page = await context.newPage();
  await page.goto(site + "/login");
  await page.getByLabel("Email", { exact: false }).fill(owner.email);
  await page.getByLabel("Password", { exact: true }).fill(owner.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL(site + "/dashboard");
  await page
    .getByRole("heading", { name: "Your websites, organized." })
    .waitFor();
  const authCookies = (await context.cookies()).filter((c) =>
    c.name.startsWith("sb-"),
  );
  assert(authCookies.length > 0);
  assert(
    authCookies.every((c) => c.httpOnly && c.sameSite === "Lax"),
    "Server-only auth cookies must be HttpOnly/Lax",
  );
  const metrics = {};
  for (const [key, path] of [
    ["dashboard", "/dashboard"],
    ["report", "/dashboard/reports/" + reportId],
  ]) {
    const start = performance.now();
    await page.goto(site + path);
    await page.locator("main h1").waitFor();
    metrics[key + "_ms"] = Math.round(performance.now() - start);
  }
  const start = performance.now();
  const responses = await Promise.all(
    Array.from({ length: 4 }, () =>
      fetch(site + "/api/reviews/" + reviewIds[1], {
        headers: { Cookie: reviewer.cookie() },
      }),
    ),
  );
  assert(responses.every((r) => r.status === 200));
  metrics.concurrent_four_review_reads_ms = Math.round(
    performance.now() - start,
  );
  const requestIds = responses.map((r) => r.headers.get("x-request-id"));
  assert(requestIds.every(Boolean));
  assert.equal(new Set(requestIds).size, 4);
  const nonceA = (await fetch(site)).headers.get("content-security-policy"),
    nonceB = (await fetch(site)).headers.get("content-security-policy");
  assert(nonceA?.includes("strict-dynamic"));
  assert(!nonceA.includes("unsafe-eval"));
  assert.notEqual(nonceA, nonceB, "CSP nonce cannot be reused");
  const publicContext = await browser.newContext();
  const publicPage = await publicContext.newPage();
  await publicPage.goto(site + "/signup");
  await publicPage.getByText(/Private beta onboarding requires/).waitFor();
  await publicContext.close();
  // A still-unexpired JWT loses database access immediately after local session sign-out.
  const staleSession = createClient(api, publishable, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const login = checked(
    await staleSession.auth.signInWithPassword({
      email: owner.email,
      password: owner.password,
    }),
    "stale-session login",
  );
  const jwt = login.session.access_token;
  const stale = createClient(api, publishable, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: "Bearer " + jwt } },
  });
  assert(
    checked(await stale.rpc("beta_access_status", {}), "active session")
      .allowed,
  );
  checked(
    await staleSession.auth.signOut({ scope: "local" }),
    "session revocation",
  );
  assert.equal(
    checked(await stale.rpc("beta_access_status", {}), "revoked session")
      .allowed,
    false,
  );
  assert.equal(
    checked(await stale.from("projects").select("id"), "revoked data denial")
      .length,
    0,
  );
  checked(
    await admin
      .from("beta_access")
      .update({ active: false })
      .eq("email", reviewer.email),
    "revoke beta admission",
  );
  const denied = await fetch(site + "/api/reviews/" + reviewIds[1], {
    headers: { Cookie: reviewer.cookie() },
    redirect: "manual",
  });
  assert.equal(denied.status, 307);
  assert(
    new URL(denied.headers.get("location"), site).pathname === "/beta-access",
  );
  assert.equal(
    checked(
      await reviewer.client.from("release_reviews").select("id"),
      "direct admission denial",
    ).length,
    0,
  );
  const image = checks.find((c) => c.check_type === "desktop");
  assert(
    (
      await reviewer.client.storage
        .from("scan-artifacts")
        .download(image.screenshot_path)
    ).error,
  );
  checked(
    await admin
      .from("beta_access")
      .update({ active: true })
      .eq("email", reviewer.email),
    "restore admission",
  );
  assert.equal(
    (
      await fetch(site + "/api/reviews/" + reviewIds[1], {
        headers: { Cookie: reviewer.cookie() },
      })
    ).status,
    200,
  );
  checked(
    await admin
      .from("beta_settings")
      .update({ scanning_enabled: false })
      .eq("singleton", true),
    "pause scanning",
  );
  assert.equal((await fetch(site + "/api/ready")).status, 503);
  assert.equal((await fetch(site + "/api/health")).status, 200);
  checked(
    await admin
      .from("beta_settings")
      .update({ scanning_enabled: true })
      .eq("singleton", true),
    "recover readiness",
  );
  assert.equal((await fetch(site + "/api/ready")).status, 200);
  // Real Auth hook and Storage API boundary with a dedicated role. This is an authorization fixture, not a public website scan.
  const workerEmail = "worker-" + randomUUID() + "@example.test",
    workerPassword = randomBytes(24).toString("base64url") + "Aa1!";
  checked(
    await admin.from("beta_access").insert({ email: workerEmail }),
    "admit worker identity",
  );
  const workerUser = checked(
    await admin.auth.admin.createUser({
      email: workerEmail,
      password: workerPassword,
      email_confirm: true,
    }),
    "create dedicated worker",
  ).user;
  let authorizationRun;
  const workerClient = createClient(api, publishable, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  try {
    checked(
      await admin
        .from("scan_worker_identities")
        .insert({ user_id: workerUser.id, active: true }),
      "register worker role",
    );
    checked(
      await workerClient.auth.signInWithPassword({
        email: workerEmail,
        password: workerPassword,
      }),
      "dedicated worker login",
    );
    const claims = checked(
      await workerClient.auth.getClaims(),
      "dedicated role claims",
    );
    assert.equal(claims.claims.role, "deployreceipt_scan_worker");
    assert(
      (await workerClient.from("projects").select("id")).error,
      "worker cannot read application data",
    );
    const parent = checked(
      await admin
        .from("scan_runs")
        .select("project_id,requested_by,target_url")
        .eq("id", checks[0].scan_run_id)
        .single(),
      "authorization fixture scope",
    );
    const lease = randomUUID();
    authorizationRun = randomUUID();
    checked(
      await admin
        .from("scan_runs")
        .insert({
          id: authorizationRun,
          project_id: parent.project_id,
          requested_by: parent.requested_by,
          target_url: parent.target_url,
          public_scope: true,
          public_consent_at: new Date().toISOString(),
          status: "running",
          worker_identity: workerUser.id,
          lease_token: lease,
          lease_until: new Date(Date.now() + 180000).toISOString(),
          attempts: 1,
        }),
      "create disposable authorization fixture",
    );
    const png = checked(
      await admin.storage
        .from("scan-artifacts")
        .download(image.screenshot_path),
      "existing real fixture PNG",
    );
    const path = authorizationRun + "/1/desktop.png";
    checked(
      await workerClient.storage
        .from("scan-artifacts")
        .upload(path, png, { contentType: "image/png", upsert: false }),
      "scoped worker upload",
    );
    assert(
      (await workerClient.storage.from("scan-artifacts").download(path)).error,
      "worker cannot read private screenshot bytes",
    );
    assert(
      (
        await workerClient.storage
          .from("scan-artifacts")
          .upload(randomUUID() + "/1/desktop.png", png, {
            contentType: "image/png",
          })
      ).error,
      "worker cannot write cross-run evidence",
    );
    checked(
      await workerClient.rpc("finish_scan", {
        p_scan_id: authorizationRun,
        p_lease: lease,
        p_status: "timed_out",
        p_checks: [],
      }),
      "assigned worker diagnostic finalization",
    );
    assert(
      (
        await workerClient.storage
          .from("scan-artifacts")
          .upload(authorizationRun + "/1/mobile.png", png, {
            contentType: "image/png",
          })
      ).error,
      "worker cannot upload after lease finalization",
    );
    checked(
      await admin
        .from("scan_worker_identities")
        .update({ active: false })
        .eq("user_id", workerUser.id),
      "revoke worker identity",
    );
    assert(
      (
        await workerClient.rpc("public_worker_attest", {
          p_ready: true,
          p_policy_version: "public-gateway-v1",
        })
      ).error,
      "revoked worker JWT cannot attest",
    );
    checked(
      await admin.storage.from("scan-artifacts").remove([path]),
      "remove disposable authorization evidence",
    );
  } finally {
    if (authorizationRun)
      await admin.from("scan_runs").delete().eq("id", authorizationRun);
    await admin.auth.admin.deleteUser(workerUser.id);
    await admin.from("beta_access").delete().eq("email", workerEmail);
  }
  const ops = checked(
    await admin.rpc("operational_status", {}),
    "operator metrics",
  );
  assert(ops.healthy_workers >= 1);
  await writeFile(
    "outputs/e2e-beta-proof.json",
    JSON.stringify(
      {
        environment: "disposable local beta; not hosted staging",
        authorized_onboarding: true,
        live_session_revocation: true,
        admission_revocation: true,
        private_storage_denied: true,
        readiness_recovery: true,
        unique_correlation_ids: true,
        nonce_csp: true,
        http_only_cookies: true,
        worker_health: true,
        dedicated_worker_auth_and_storage: true,
        metrics,
      },
      null,
      2,
    ),
  );
  await context.close();
}
