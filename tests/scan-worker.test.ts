import { it, expect, vi } from "vitest";
import { processJob, type JobStore } from "../worker/process-job";
import type { ScanJob } from "../src/features/scans/types";
import type { ScanResult } from "../worker/engine";
const job = {
  kind: "scan",
  message_id: "1",
  lease: "lease",
  run: { id: "scan", attempts: 1 },
  settings: { screenshot_bytes: 10000 },
} as Extract<ScanJob, { kind: "scan" }>;
function store() {
  return {
    finishScan: vi.fn().mockResolvedValue(true),
    finishVerification: vi.fn().mockResolvedValue(true),
    retry: vi.fn(),
    upload: vi.fn(),
    acknowledge: vi.fn(),
  } satisfies JobStore;
}
const result = (): ScanResult => ({
  status: "completed",
  checks: [
    {
      check_type: "desktop",
      outcome: "pass",
      description: "Observed",
      details: {},
      duration_ms: 1,
      screenshot_path: null,
    },
  ],
  artifacts: { desktop: Buffer.from("png") },
});
it("uploads then durably persists results before queue acknowledgement", async () => {
  const db = store();
  await processJob(job, db, async () => result(), vi.fn());
  expect(db.upload).toHaveBeenCalledWith(
    "scan/1/desktop.png",
    expect.any(Buffer),
  );
  expect(db.upload.mock.invocationCallOrder[0]).toBeLessThan(
    db.finishScan.mock.invocationCallOrder[0],
  );
  expect(db.finishScan.mock.invocationCallOrder[0]).toBeLessThan(
    db.acknowledge.mock.invocationCallOrder[0],
  );
});
it("does not acknowledge a stale/duplicate lease", async () => {
  const db = store();
  db.finishScan.mockResolvedValue(false);
  await processJob(job, db, async () => result(), vi.fn());
  expect(db.acknowledge).not.toHaveBeenCalled();
});
it("retries upload failures rather than storing false completion", async () => {
  const db = store();
  db.upload.mockRejectedValue(new Error("offline"));
  await processJob(job, db, async () => result(), vi.fn());
  expect(db.finishScan).not.toHaveBeenCalled();
  expect(db.retry).toHaveBeenCalledWith(job);
});
it("persists genuine timeout status", async () => {
  const db = store();
  await processJob(
    job,
    db,
    async () => ({ status: "timed_out", checks: [], artifacts: {} }),
    vi.fn(),
  );
  expect(db.finishScan).toHaveBeenCalledWith(job, {
    status: "timed_out",
    checks: [],
    artifacts: {},
  });
});
it("does not silently accept oversized artifacts", async () => {
  const db = store();
  await processJob(
    { ...job, settings: { ...job.settings, screenshot_bytes: 1 } },
    db,
    async () => result(),
    vi.fn(),
  );
  expect(db.upload).not.toHaveBeenCalled();
  expect(db.retry).toHaveBeenCalled();
});

it("bounds browser disconnect if the remote browser stops responding", async () => {
  vi.useFakeTimers();
  try {
    const { disconnectBrowser } = await import("../worker/engine");
    const disconnected = disconnectBrowser({
      close: () => new Promise<void>(() => {}),
    });
    await vi.advanceTimersByTimeAsync(5000);
    await expect(disconnected).resolves.toBeUndefined();
  } finally {
    vi.useRealTimers();
  }
});
