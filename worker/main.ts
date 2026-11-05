import { openGateway } from "./gateway-client";
import { publicOrigin } from "./gateway/policy";
import { writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";
import type { Database } from "../src/lib/supabase/types";
import type { ScanJob } from "../src/features/scans/types";
import { fixtureUrl } from "./security";
import { scanWebsite, disconnectBrowser } from "./engine";
import { verifyDomain } from "./verification";
import { processJob, type JobStore } from "./process-job";

const publicMode = process.env.SCAN_WORKER_MODE === "public";
if (
  publicMode &&
  (process.env.APP_ENV !== "staging" ||
    process.env.PUBLIC_SCAN_STAGING !== "approved" ||
    process.env.SUPABASE_SECRET_KEY)
)
  throw Error("approved_staging_worker_required");
const codeSha = process.env.SCAN_CODE_SHA;
if (publicMode && (!codeSha || !/^[a-f0-9]{40}$/.test(codeSha)))
  throw Error("verified_code_revision_required");
const url = process.env.SUPABASE_URL,
  key = publicMode
    ? process.env.SUPABASE_PUBLISHABLE_KEY
    : process.env.SUPABASE_SECRET_KEY;
if (
  !url ||
  !key ||
  (publicMode
    ? !key.startsWith("sb_publishable_")
    : !key.startsWith("sb_secret_"))
)
  throw Error("worker_credentials_required");
const client = createClient<Database>(url, key, {
  auth: { persistSession: false, autoRefreshToken: publicMode },
  global: {
    fetch: (input, options) =>
      fetch(input, {
        ...options,
        signal: options?.signal
          ? AbortSignal.any([options.signal, AbortSignal.timeout(10000)])
          : AbortSignal.timeout(10000),
      }),
  },
});
async function rpc<T>(response: PromiseLike<{ data: T; error: unknown }>) {
  const result = await response;
  if (result.error) throw new Error("worker_database_error");
  return result.data;
}
const store: JobStore = {
  async finishScan(job, result) {
    return Boolean(
      await rpc(
        client.rpc("finish_scan", {
          p_scan_id: job.run.id,
          p_lease: job.lease,
          p_status: result.status,
          p_checks: JSON.parse(JSON.stringify(result.checks)),
        }),
      ),
    );
  },
  async finishVerification(job, result) {
    return Boolean(
      await rpc(
        client.rpc("finish_verification", {
          p_project_id: job.verification.project_id,
          p_lease: job.lease,
          p_verified: result.verified,
          p_method: result.method,
        }),
      ),
    );
  },
  async retry(job) {
    await rpc(
      client.rpc("retry_scan", { p_scan_id: job.run.id, p_lease: job.lease }),
    );
  },
  async upload(path, bytes) {
    const { error } = await client.storage
      .from("scan-artifacts")
      .upload(path, bytes, { contentType: "image/png", upsert: !publicMode });
    if (error) throw new Error("artifact_upload_failed");
  },
  async acknowledge(messageId) {
    await rpc(client.rpc("ack_scan_job", { p_message_id: messageId }));
  },
};
const instance = randomUUID();
let lastHeartbeat = 0,
  scanningEnabled = false;
async function health(
  ready: boolean,
  error?: "database_unavailable" | "worker_failure",
) {
  const data = await rpc(
    client.rpc("worker_tick", {
      p_instance: instance,
      p_ready: ready,
      p_error: error ?? null,
    }),
  );
  scanningEnabled = Boolean(data?.scanning_enabled);
  if (publicMode) {
    const responses = await Promise.all([
      fetch("http://public-gateway:9080/health", {
        signal: AbortSignal.timeout(3000),
      }),
      fetch("http://public-browser:9001/health", {
        signal: AbortSignal.timeout(3000),
      }),
    ]);
    if (responses.some((response) => !response.ok))
      throw Error("public_dependencies_unavailable");
    const gatewayHealth = await responses[0].json();
    const browserHealth = await responses[1].json();
    if (
      gatewayHealth.code_sha !== codeSha ||
      browserHealth.code_sha !== codeSha
    )
      throw Error("security_revision_mismatch");
    if (
      browserHealth.policy !== "public-gateway-v1" ||
      browserHealth.ready !== true
    )
      throw Error("browser_policy_unavailable");
    scanningEnabled =
      Boolean(
        await rpc(
          client.rpc("public_worker_attest", {
            p_ready: ready,
            p_policy_version: "public-gateway-v1",
            p_security_suite_sha: codeSha!,
          }),
        ),
      ) && scanningEnabled;
  }
  lastHeartbeat = Date.now();
  await writeFile(
    "/tmp/deployreceipt-worker-health.json",
    JSON.stringify({
      ready,
      at: lastHeartbeat,
      phase: scanningEnabled
        ? publicMode
          ? "public_staging"
          : "fixture"
        : "paused",
    }),
  );
}
let stopping = false,
  lastCleanup = 0;
process.on("SIGTERM", () => {
  stopping = true;
});
process.on("SIGINT", () => {
  stopping = true;
});
async function main() {
  if (publicMode) {
    const email = process.env.WORKER_EMAIL,
      password = process.env.WORKER_PASSWORD;
    if (!email || !password) throw Error("dedicated_worker_login_required");
    const login = await client.auth.signInWithPassword({ email, password });
    if (login.error) throw Error("dedicated_worker_login_failed");
    const claims = await client.auth.getClaims();
    if (
      claims.error ||
      claims.data?.claims.role !== "deployreceipt_scan_worker"
    )
      throw Error("least_privilege_worker_role_required");
  }
  // Keep readiness fresh during a bounded scan, independently of queue polling.
  let heartbeatPending = false;
  const timer = setInterval(() => {
    if (heartbeatPending || stopping) return;
    heartbeatPending = true;
    void health(true)
      .catch(async () => {
        scanningEnabled = false;
        await writeFile(
          "/tmp/deployreceipt-worker-health.json",
          JSON.stringify({ ready: false, at: Date.now() }),
        ).catch(() => {});
      })
      .finally(() => {
        heartbeatPending = false;
      });
  }, 15000);
  timer.unref();
  while (!stopping) {
    try {
      if (Date.now() - lastHeartbeat > 15000) await health(true);
      if (Date.now() - lastCleanup > 60000) {
        const paths = await rpc(client.rpc("expired_scan_artifacts", {}));
        if (paths?.length) {
          const { error } = await client.storage
            .from("scan-artifacts")
            .remove(paths);
          if (error) throw new Error("cleanup_failed");
        }
        lastCleanup = Date.now();
      }
      if (!scanningEnabled) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        continue;
      }
      const data = await rpc(client.rpc("lease_scan_job", {}));
      if (!data) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        continue;
      }
      const job = data as unknown as ScanJob;
      await processJob(
        job,
        store,
        async (scan) => {
          if (publicMode) {
            if (scan.settings.mode !== "public" || !scan.verification)
              throw Error("public_authorization_required");
            const target = publicOrigin(scan.run.target_url);
            if (
              target.hostname !== scan.verification.domain ||
              new Date(scan.verification.expires_at).getTime() <= Date.now()
            )
              throw Error("verification_expired");
            const fresh = await verifyDomain(
              target.href,
              scan.verification.token,
              "public",
            );
            if (!fresh.verified || fresh.method !== "dns")
              throw Error("dns_authority_recheck_failed");
            const gateway = await openGateway(
              target.href,
              Math.min(100, scan.settings.max_requests),
              Math.min(90, scan.settings.timeout_seconds),
            );
            let browser:
              | Awaited<ReturnType<typeof chromium.connect>>
              | undefined;
            let leasedBrowser = false;
            try {
              const recorded = await rpc(
                client.rpc("record_scan_configuration", {
                  p_scan_id: scan.run.id,
                  p_lease: scan.lease,
                  p_configuration: JSON.parse(
                    JSON.stringify({
                      ...scan.settings,
                      transport: "pinned_gateway_v1",
                      worker_revision: codeSha,
                      policy_version: "public-gateway-v1",
                      response_bytes_limit: 2097152,
                      job_bytes_limit: 16777216,
                      redirect_limit: 5,
                      network_family: "ipv4",
                      third_party: "blocked",
                      methods: ["GET", "HEAD"],
                    }),
                  ),
                }),
              );
              if (!recorded) throw Error("stale_scan_lease");
              const leaseResponse = await fetch(
                "http://public-browser:9001/lease",
                {
                  method: "POST",
                  headers: { "x-public-policy-revision": codeSha! },
                  body: JSON.stringify({ id: scan.run.id }),
                  signal: AbortSignal.timeout(3000),
                },
              );
              if (!leaseResponse.ok) throw Error("browser_process_busy");
              leasedBrowser = true;
              browser = await chromium.connect(
                "ws://public-browser:9000/scan-browser",
                { timeout: 10000 },
              );
              return await scanWebsite(
                browser,
                target.href,
                scan.settings,
                undefined,
                gateway,
              );
            } finally {
              if (leasedBrowser) {
                await fetch("http://public-browser:9001/dispose", {
                  method: "POST",
                  headers: { "x-public-policy-revision": codeSha! },
                  signal: AbortSignal.timeout(3000),
                }).catch(() => {});
              }
              if (browser) await disconnectBrowser(browser);
              await gateway.close();
            }
          }
          if (
            process.env.SCAN_WORKER_MODE !== "local" ||
            scan.settings.mode !== "local"
          )
            throw new Error("local_mode_required");
          fixtureUrl(scan.run.target_url);
          const recorded = await rpc(
            client.rpc("record_scan_configuration", {
              p_scan_id: scan.run.id,
              p_lease: scan.lease,
              p_configuration: JSON.parse(JSON.stringify(scan.settings)),
            }),
          );
          if (!recorded) throw new Error("stale_scan_lease");
          // This endpoint exists only inside the isolated local Compose topology.
          const browser = await chromium.connect(
            "ws://browser:9000/scan-browser",
            { timeout: 10000 },
          );
          try {
            return await scanWebsite(
              browser,
              scan.run.target_url,
              scan.settings,
            );
          } finally {
            await disconnectBrowser(browser);
          }
        },
        (verify) =>
          verifyDomain(
            verify.target_url,
            verify.verification.token,
            verify.settings.mode,
          ),
      );
      console.info(JSON.stringify({ event: "worker_attempt_processed" }));
    } catch {
      console.error(
        JSON.stringify({
          event: "worker_dependency_unavailable",
          code: "worker_failure",
        }),
      );
      await writeFile(
        "/tmp/deployreceipt-worker-health.json",
        JSON.stringify({ ready: false, at: Date.now() }),
      ).catch(() => {});
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
  }
}
void main();
