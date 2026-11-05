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

const url = process.env.SUPABASE_URL,
  key = process.env.SUPABASE_SECRET_KEY;
if (!url || !key?.startsWith("sb_secret_"))
  throw new Error(
    "Worker requires SUPABASE_URL and a server-only Supabase secret key.",
  );
const client = createClient<Database>(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
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
      .upload(path, bytes, { contentType: "image/png", upsert: true });
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
  lastHeartbeat = Date.now();
  await writeFile(
    "/tmp/deployreceipt-worker-health.json",
    JSON.stringify({
      ready,
      at: lastHeartbeat,
      phase: scanningEnabled ? "fixture" : "paused",
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
