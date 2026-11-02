export type ScanStatus =
  "queued" | "running" | "completed" | "failed" | "timed_out";
export type ScanRun = {
  configuration_snapshot?: Record<string, unknown> | null;
  verification_snapshot?: Record<string, unknown> | null;
  id: string;
  project_id: string;
  requested_by: string;
  target_url: string;
  status: ScanStatus;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  passed_count: number;
  failed_count: number;
  warning_count: number;
  error_code: string | null;
  error_message: string | null;
  attempts: number;
  lease_token: string | null;
  lease_until: string | null;
};
export type ScanCheck = {
  id: string;
  scan_run_id: string;
  check_type:
    "availability" | "desktop" | "mobile" | "javascript" | "links" | "network";
  outcome: "pass" | "fail" | "warning";
  description: string;
  details: Record<string, unknown>;
  duration_ms: number | null;
  screenshot_path: string | null;
};
export type Finding = Omit<ScanCheck, "id" | "scan_run_id">;
export type Verification = {
  project_id: string;
  domain: string;
  token: string;
  status: "pending" | "verified" | "failed";
  method: "dns" | "local_fixture";
  created_at: string;
  last_queued_at: string;
  checked_at: string | null;
  verified_at: string | null;
  expires_at: string | null;
  attempts: number;
  lease_token: string | null;
  lease_until: string | null;
};
export type ScanSettings = {
  singleton: boolean;
  mode: "disabled" | "local";
  daily_allowance: number;
  cooldown_seconds: number;
  timeout_seconds: number;
  max_attempts: number;
  max_links: number;
  max_requests: number;
  screenshot_bytes: number;
  retention_days: number;
};
export type ScanJob =
  | {
      kind: "scan";
      message_id: string;
      lease: string;
      run: ScanRun;
      settings: ScanSettings;
    }
  | {
      kind: "verify";
      message_id: string;
      lease: string;
      verification: Verification;
      target_url: string;
      settings: ScanSettings;
    };
