import type { ScanRun, ScanCheck } from "@/features/scans/types";
export type ReportRecord = {
  id: string;
  scan_run_id: string;
  project_id: string;
  project_name: string;
  target_url: string;
  kind: "qa" | "diagnostic";
  created_by: string;
  created_at: string;
};
export type Severity = "critical" | "high" | "medium" | "low";
export type Resolution = "open" | "investigating" | "resolved" | "ignored";
export type Triage = {
  report_id: string;
  scan_run_id: string;
  scan_check_id: string;
  severity: Severity | null;
  resolution: Resolution;
  notes: string;
  revision: number;
  updated_by: string;
  updated_at: string;
};
export type Comment = {
  id: string;
  report_id: string;
  scan_check_id: string;
  author_id: string;
  body: string;
  created_at: string;
};
export type EvidenceLink = {
  report_id: string;
  scan_run_id: string;
  finding_check_id: string;
  evidence_check_id: string;
  attached_by: string;
  created_at: string;
};
export type EvidenceState = {
  checkId: string;
  type: string;
  path: string | null;
  state: "available" | "expired" | "missing" | "unavailable";
  bytes?: Uint8Array;
};
export type ReportModel = {
  report: ReportRecord;
  scan: ScanRun;
  findings: Array<{
    check: ScanCheck;
    triage: Triage;
    comments: Comment[];
    evidenceIds: string[];
    guidance: string;
  }>;
  evidence: EvidenceState[];
  limitations: string[];
  durationMs: number | null;
  counts: { pass: number; fail: number; warning: number };
  retentionDays: number;
};
