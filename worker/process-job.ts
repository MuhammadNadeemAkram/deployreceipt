import type { ScanJob } from "../src/features/scans/types";
import type { ScanResult } from "./engine";
export interface JobStore {
  finishScan(
    job: Extract<ScanJob, { kind: "scan" }>,
    result: ScanResult,
  ): Promise<boolean>;
  finishVerification(
    job: Extract<ScanJob, { kind: "verify" }>,
    result: { verified: boolean; method: "dns" | "local_fixture" },
  ): Promise<boolean>;
  retry(job: Extract<ScanJob, { kind: "scan" }>): Promise<void>;
  upload(path: string, bytes: Buffer): Promise<void>;
  acknowledge(messageId: string): Promise<void>;
}
export async function processJob(
  job: ScanJob,
  store: JobStore,
  scan: (job: Extract<ScanJob, { kind: "scan" }>) => Promise<ScanResult>,
  verify: (
    job: Extract<ScanJob, { kind: "verify" }>,
  ) => Promise<{ verified: boolean; method: "dns" | "local_fixture" }>,
) {
  try {
    if (job.kind === "verify") {
      if (await store.finishVerification(job, await verify(job)))
        await store.acknowledge(job.message_id);
      return;
    }
    const result = await scan(job);
    for (const type of ["desktop", "mobile"] as const) {
      const bytes = result.artifacts[type];
      if (!bytes) continue;
      if (bytes.length > job.settings.screenshot_bytes)
        throw new Error("artifact_limit");
      const path = `${job.run.id}/${job.run.attempts}/${type}.png`;
      await store.upload(path, bytes);
      const check = result.checks.find((item) => item.check_type === type);
      if (check) check.screenshot_path = path;
    }
    if (await store.finishScan(job, result))
      await store.acknowledge(job.message_id);
  } catch {
    if (job.kind === "scan") {
      await store.retry(job);
      await store.acknowledge(job.message_id);
    } // SQL refuses acknowledgement while a retry is queued.
    // Verification operational errors retain the lease/message and retry after visibility expiry.
  }
}
