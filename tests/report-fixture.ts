import { deflateSync } from "node:zlib";
import type { ReportRecord, Triage } from "@/features/reports/types";
import type { ScanRun, ScanCheck } from "@/features/scans/types";
import { buildReport } from "@/features/reports/model";
export const reportId = "44444444-4444-4444-8444-444444444444",
  runId = "55555555-5555-4555-8555-555555555555",
  projectId = "66666666-6666-4666-8666-666666666666";
export function reportFixture() {
  const scan: ScanRun = {
    id: runId,
    project_id: projectId,
    requested_by: "owner",
    target_url: "http://fixture:8080/",
    status: "completed",
    created_at: "2026-11-02T10:00:00Z",
    started_at: "2026-11-02T10:00:01Z",
    completed_at: "2026-11-02T10:00:08Z",
    passed_count: 3,
    failed_count: 1,
    warning_count: 2,
    error_code: null,
    error_message: null,
    attempts: 1,
    lease_token: null,
    lease_until: null,
    configuration_snapshot: {
      mode: "local",
      max_links: 5,
      max_requests: 100,
      timeout_seconds: 90,
      desktop_viewport: "1440x900",
      mobile_viewport: "390x844",
      source: "worker_attempt",
    },
    verification_snapshot: {
      domain: "fixture",
      method: "local_fixture",
      verified_at: "2026-11-02T09:50:00Z",
    },
  };
  const report: ReportRecord = {
    id: reportId,
    scan_run_id: runId,
    project_id: projectId,
    project_name: "Controlled test fixture",
    target_url: scan.target_url,
    kind: "qa",
    created_by: "owner",
    created_at: "2026-11-02T11:00:00Z",
  };
  const types = [
    "availability",
    "desktop",
    "mobile",
    "javascript",
    "links",
    "network",
  ] as const;
  const checks: ScanCheck[] = types.map((check_type, index) => ({
    id: `77777777-7777-4777-8777-${String(index + 1).padStart(12, "0")}`,
    scan_run_id: runId,
    check_type,
    outcome: index < 3 ? "pass" : index === 4 ? "fail" : "warning",
    description: [
      "Navigation completed with HTTP 200.",
      "Desktop viewport captured.",
      "Mobile viewport captured.",
      "Fixture console errors observed.",
      "A controlled broken link returned HTTP 404.",
      "Policy-blocked redirect observed.",
    ][index],
    details: { fixture: true, observed_status: index === 4 ? 404 : 200 },
    duration_ms: 100 + index,
    screenshot_path:
      index === 1 || index === 2 ? `${runId}/1/${check_type}.png` : null,
  }));
  const triage: Triage[] = checks.map((check) => ({
    report_id: reportId,
    scan_run_id: runId,
    scan_check_id: check.id,
    severity: null,
    resolution: "open",
    notes: "",
    revision: 1,
    updated_by: "owner",
    updated_at: "2026-11-02T11:00:00Z",
  }));
  return {
    report,
    scan,
    checks,
    triage,
    comments: [],
    links: [],
    retentionDays: 7,
    now: new Date("2026-11-02T12:00:00Z"),
  };
}
export const sampleReport = () => buildReport(reportFixture());
function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++)
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Buffer) {
  const body = Buffer.concat([Buffer.from(type), data]);
  const size = Buffer.alloc(4);
  size.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([size, body, crc]);
}
export function pngFixture(width = 100, height = 60) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const rows = Buffer.alloc((width * 4 + 1) * height);
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const offset = row * (width * 4 + 1) + 1 + col * 4;
      rows[offset] = 32;
      rows[offset + 1] = 110;
      rows[offset + 2] = 80;
      rows[offset + 3] = 255;
    }
  }
  return Buffer.concat([
    Buffer.from("89504e470d0a1a0a", "hex"),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(rows)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
