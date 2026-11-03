// Called only by the disposable local-stack integration harness, with real sessions.
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
export async function verifyReleaseWorkflow({
  owner,
  reviewer,
  outsider,
  reportId,
  checks,
  browser,
  site,
  admin,
}) {
  const checked = (r, label) => {
    if (r.error)
      throw new Error(
        label +
          ": " +
          String(r.error.code ?? r.error.status ?? "service_error"),
      );
    return r.data;
  };
  const reviewerUser = checked(
    await reviewer.client.auth.getUser(),
    "reviewer identity",
  ).user;
  const reviewerEmail = reviewerUser.email;
  assert(reviewerUser.email_confirmed_at);
  const ownerContext = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
    }),
    clientContext = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
    });
  ownerContext.setDefaultTimeout(15000);
  clientContext.setDefaultTimeout(15000);
  ownerContext.setDefaultNavigationTimeout(30000);
  clientContext.setDefaultNavigationTimeout(30000);
  const cookies = (session) =>
    [...session.jar].map(([name, value]) => ({ name, value, url: site }));
  await ownerContext.addCookies(cookies(owner));
  await clientContext.addCookies(cookies(reviewer));
  const developer = await ownerContext.newPage(),
    client = await clientContext.newPage();
  const record = async (id) =>
    checked(
      await owner.client
        .from("release_reviews")
        .select("*")
        .eq("id", id)
        .single(),
      "read owner version",
    );
  const invitation = async (id) =>
    checked(
      await owner.client
        .from("review_invitations")
        .select("*")
        .eq("review_id", id)
        .in("status", ["pending", "accepted"])
        .single(),
      "read current invitation",
    );
  async function createViaUI(title, previous) {
    await developer.goto(
      previous
        ? site + "/dashboard/releases/new?previous=" + previous
        : site + "/dashboard/releases/new?report=" + reportId,
    );
    await developer.getByLabel("Release name / version").fill(title);
    await developer
      .getByLabel("Release notes", { exact: true })
      .fill(
        "Controlled fixture release. No deployment or certification is implied.",
      );
    await developer.getByLabel("Primary reviewer email").fill(reviewerEmail);
    await developer
      .getByRole("button", { name: "Create immutable draft" })
      .click();
    await developer.waitForURL(/\/dashboard\/releases\/[a-f0-9-]{36}$/);
    return developer.url().split("/").at(-1);
  }
  async function submitViaUI() {
    await developer.getByLabel("Review action").selectOption("submit");
    await developer
      .getByRole("button", { name: "Apply review action" })
      .click();
    await developer.getByText("pending review", { exact: true }).waitFor();
  }
  async function acceptViaUI(id) {
    const i = await invitation(id);
    await client.goto(site + "/review-invitations/" + i.id);
    await client
      .getByRole("button", { name: "Accept invitation and open review" })
      .click();
    await client.waitForURL(site + "/reviews/" + id);
    await client
      .getByRole("heading", { name: "Findings in this version" })
      .waitFor();
  }
  try {
    const v1 = await createViaUI("Controlled release v1");
    const original = await record(v1);
    assert.equal(original.version, 1);
    await submitViaUI();
    const unaccepted = checked(
      await reviewer.client.from("release_reviews").select("id").eq("id", v1),
      "unaccepted visibility",
    );
    assert.equal(unaccepted.length, 0);
    await acceptViaUI(v1);
    const png = await client.request.get(
      site +
        "/api/reviews/" +
        v1 +
        "/evidence/" +
        checks.find((c) => c.check_type === "desktop").id,
    );
    assert.equal(png.status(), 200);
    assert(png.headers()["content-type"].includes("image/png"));
    const literal =
      "<script>window.reviewInjection=true</script> Please fix this finding.";
    await client.getByLabel("Feedback", { exact: true }).fill(literal);
    await client
      .getByLabel("Related finding")
      .selectOption(checks.find((c) => c.check_type === "links").id);
    await client.getByLabel("Feedback type").selectOption("change_request");
    await client
      .getByRole("button", { name: "Record feedback / reply" })
      .click();
    await client.getByText(literal, { exact: true }).waitFor();
    assert.equal(
      await client.evaluate(() => globalThis.reviewInjection),
      undefined,
    );
    await client
      .getByLabel("Decision", { exact: true })
      .selectOption("changes_requested");
    await client
      .getByLabel("Decision notes (required for changes requested)")
      .fill("Fix the broken fixture link before the next release review.");
    await client
      .getByRole("button", { name: "Record final decision for this version" })
      .click();
    await client
      .getByRole("heading", { name: "changes requested · version 1" })
      .waitFor();
    await developer.reload();
    await developer.getByText(literal, { exact: true }).waitFor();
    await developer
      .getByLabel("Feedback", { exact: true })
      .fill("Developer response: revised QA explanation prepared.");
    await developer
      .getByRole("button", { name: "Record feedback / reply" })
      .click();
    await developer
      .getByText("Developer response: revised QA explanation prepared.", {
        exact: true,
      })
      .waitFor();
    await client.reload();
    await client
      .getByText("Developer response: revised QA explanation prepared.", {
        exact: true,
      })
      .waitFor();
    await developer
      .locator("#comment-" + feedback.id)
      .getByRole("button", { name: "Mark feedback resolved" })
      .click();
    await developer
      .locator("#comment-" + feedback.id)
      .getByText(/^Resolved /)
      .waitFor();
    const link = checks.find((c) => c.check_type === "links");
    const triage = checked(
      await owner.client
        .from("qa_finding_triage")
        .select("*")
        .eq("report_id", reportId)
        .eq("scan_check_id", link.id)
        .single(),
      "read triage revision",
    );
    checked(
      await owner.client.rpc("save_qa_triage", {
        p_report_id: reportId,
        p_check_id: link.id,
        p_severity: "high",
        p_resolution: "investigating",
        p_notes:
          "Revised explanation for release v2; original automated result remains unchanged.",
        p_revision: triage.revision,
        p_evidence: [],
      }),
      "update report for v2",
    );
    const v2 = await createViaUI("Controlled release v2", v1);
    const revised = await record(v2);
    assert.equal(revised.version, 2);
    assert.notEqual(original.snapshot_digest, revised.snapshot_digest);
    assert.deepEqual((await record(v1)).snapshot, original.snapshot);
    assert.equal(
      revised.snapshot.findings.find((f) => f.id === link.id).notes,
      "Revised explanation for release v2; original automated result remains unchanged.",
    );
    await submitViaUI();
    await acceptViaUI(v2);
    assert.equal(
      (await client.request.get(site + "/dashboard/releases/" + v2)).status(),
      404,
    );
    assert.equal(
      checked(
        await reviewer.client
          .from("qa_reports")
          .select("id")
          .eq("id", reportId),
        "reviewer original report denial",
      ).length,
      0,
    );
    const third = await fetch(site + "/reviews/" + v2, {
      headers: { Cookie: outsider.cookie() },
      redirect: "manual",
    });
    assert.equal(third.status, 404);
    const thirdEvidence = await fetch(
      site +
        "/api/reviews/" +
        v2 +
        "/evidence/" +
        checks.find((c) => c.check_type === "desktop").id,
      { headers: { Cookie: outsider.cookie() }, redirect: "manual" },
    );
    assert.equal(thirdEvidence.status, 404);
    await client
      .getByLabel("Decision", { exact: true })
      .selectOption("approved");
    await client
      .getByLabel("Decision notes (required for changes requested)")
      .fill(
        "Accept this exact fixture release with the disclosed failed checks and warnings.",
      );
    await client
      .getByLabel(
        "I reviewed this exact version and understand the approval scope.",
      )
      .check();
    await client.getByLabel(/^I explicitly acknowledge/).check();
    await client.getByLabel(/^I reviewed the available evidence/).check();
    await client
      .getByRole("button", { name: "Record final decision for this version" })
      .click();
    await client
      .getByRole("heading", { name: "approved · version 2" })
      .waitFor();
    const history = checked(
      await owner.client
        .from("review_decisions")
        .select("*")
        .in("review_id", [v1, v2]),
      "decision history",
    );
    assert.equal(history.length, 2);
    assert.equal(
      history.find((d) => d.review_id === v1).decision,
      "changes_requested",
    );
    assert.equal(history.find((d) => d.review_id === v2).decision, "approved");
    const replay = await reviewer.client.rpc("decide_release_review", {
      p_id: v2,
      p_version: 2,
      p_digest: revised.snapshot_digest,
      p_decision: "approved",
      p_scope_ack: true,
      p_observations_ack: true,
      p_evidence_ack: true,
      p_notes: "Replay",
    });
    assert(replay.error);
    await developer.reload();
    await developer.screenshot({ path: "outputs/e2e-release-owner.png" });
    await developer
      .getByRole("heading", { name: "Audit timeline" })
      .scrollIntoViewIfNeeded();
    await developer.screenshot({ path: "outputs/e2e-release-timeline.png" });
    await client.reload();
    await client.screenshot({ path: "outputs/e2e-client-review-desktop.png" });
    const mobile = await browser.newContext({
      viewport: { width: 390, height: 844 },
    });
    await mobile.addCookies(cookies(reviewer));
    const mobilePage = await mobile.newPage();
    await mobilePage.goto(site + "/reviews/" + v2);
    await mobilePage
      .getByRole("heading", { name: "Controlled release v2", exact: true })
      .waitFor();
    assert(
      await mobilePage.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    await mobilePage.screenshot({
      path: "outputs/e2e-client-review-mobile.png",
    });
    await mobile.close();
    // Two real concurrent database transactions must produce exactly one decision.
    const v3 = checked(
      await owner.client.rpc("create_release_review", {
        p_report: reportId,
        p_title: "Concurrency verification",
        p_notes: "Fixture only",
        p_email: reviewerEmail,
        p_previous: v2,
      }),
      "concurrency draft",
    );
    checked(
      await owner.client.rpc("manage_release_review", {
        p_id: v3,
        p_action: "submit",
      }),
      "concurrency submit",
    );
    checked(
      await reviewer.client.rpc("accept_review_invitation", {
        p_invitation: (await invitation(v3)).id,
      }),
      "concurrency accept",
    );
    const concurrent = await record(v3);
    const args = {
      p_id: v3,
      p_version: 3,
      p_digest: concurrent.snapshot_digest,
      p_decision: "approved",
      p_scope_ack: true,
      p_observations_ack: true,
      p_evidence_ack: true,
      p_notes: "Concurrent decision test",
    };
    const races = await Promise.all([
      reviewer.client.rpc("decide_release_review", args),
      reviewer.client.rpc("decide_release_review", args),
    ]);
    assert.equal(races.filter((r) => !r.error).length, 1);
    assert.equal(races.filter((r) => r.error).length, 1);
    checked(
      await owner.client.rpc("manage_release_review", {
        p_id: v3,
        p_action: "revoke",
      }),
      "revoke accepted invitation",
    );
    assert.equal(
      (await client.request.get(site + "/reviews/" + v3)).status(),
      404,
    );
    assert.equal(
      (
        await client.request.get(
          site +
            "/api/reviews/" +
            v3 +
            "/evidence/" +
            checks.find((c) => c.check_type === "desktop").id,
        )
      ).status(),
      404,
    );
    const stale = await reviewer.client.rpc("decide_release_review", {
      ...args,
      p_id: v2,
      p_version: 1,
      p_digest: original.snapshot_digest,
    });
    assert(stale.error);
    const events = checked(
      await owner.client
        .from("review_events")
        .select("*")
        .in("review_id", [v1, v2, v3]),
      "owner timeline",
    );
    for (const type of [
      "draft_created",
      "review_submitted",
      "invitation_created",
      "invitation_accepted",
      "comment_added",
      "changes_requested",
      "release_approved",
      "review_revoked",
      "feedback_resolution_changed",
      "new_version_created",
    ])
      assert(
        events.some((e) => e.event_type === type),
        "Missing audit event " + type,
      );
    const missingPath = checks.find(
      (c) => c.check_type === "mobile",
    ).screenshot_path;
    checked(
      await admin.storage.from("scan-artifacts").remove([missingPath]),
      "remove fixture evidence",
    );
    assert.equal(
      (
        await client.request.get(
          site +
            "/api/reviews/" +
            v2 +
            "/evidence/" +
            checks.find((c) => c.check_type === "mobile").id,
        )
      ).status(),
      404,
    );
    await writeFile(
      "outputs/e2e-release-proof.json",
      JSON.stringify(
        {
          environment:
            "disposable local CI fixture; verified temporary accounts",
          v1,
          v2,
          v1_decision: "changes_requested",
          v2_decision: "approved",
          v1_digest: original.snapshot_digest,
          v2_digest: revised.snapshot_digest,
          owner_to_reviewer_ui: true,
          real_private_png: true,
          immutable_snapshot: true,
          third_account_denied: true,
          original_project_history_denied: true,
          concurrent_decisions_one_winner: true,
          replay_denied: true,
          revocation_denies_access: true,
          missing_evidence_denied: true,
          literal_html_not_executed: true,
          audit_events: events.length,
        },
        null,
        2,
      ),
    );
    return { reviewIds: [v1, v2, v3], reviewer };
  } catch (error) {
    await developer
      .screenshot({ path: "outputs/e2e-release-failed-owner.png" })
      .catch(() => {});
    await client
      .screenshot({ path: "outputs/e2e-release-failed-client.png" })
      .catch(() => {});
    throw error;
  } finally {
    await ownerContext.close();
    await clientContext.close();
  }
}
