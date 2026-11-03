export type ReviewStatus =
  | "draft"
  | "pending_review"
  | "changes_requested"
  | "approved"
  | "revoked"
  | "expired";
export type SnapshotFinding = {
  id: string;
  type: string;
  outcome: string;
  description: string;
  details: unknown;
  duration_ms: number | null;
  severity: string | null;
  resolution: string;
  notes: string;
  triage_revision: number;
  comments: { body: string; created_at: string }[];
  evidence_ids: string[];
};
export type ReviewSnapshot = {
  schema: number;
  review_id: string;
  version: number;
  title: string;
  release_notes: string;
  report_id: string;
  scan_id: string;
  project_id: string;
  project_name: string;
  target_url: string;
  scan_date: string;
  started_at: string;
  completed_at: string;
  scan_status: string;
  configuration: unknown;
  authorization: unknown;
  passed: number;
  failed: number;
  warnings: number;
  findings: SnapshotFinding[];
  limitations: string[];
};
export type ReleaseReview = {
  id: string;
  project_id: string;
  report_id: string;
  scan_run_id: string;
  owner_id: string;
  root_id: string;
  previous_id: string | null;
  version: number;
  title: string;
  release_notes: string;
  status: ReviewStatus;
  snapshot: ReviewSnapshot;
  snapshot_digest: string;
  created_at: string;
  submitted_at: string | null;
  completed_at: string | null;
  expires_at: string;
};
export type ReviewInvitation = {
  id: string;
  review_id: string;
  invited_email: string;
  reviewer_user_id: string | null;
  status: "pending" | "accepted" | "revoked" | "expired";
  expires_at: string;
  revoked_at: string | null;
  accepted_at: string | null;
  created_at: string;
};
export type ReviewEvidence = {
  review_id: string;
  check_id: string;
  path: string;
  kind: string;
  expires_at: string;
};
export type ReviewComment = {
  id: string;
  review_id: string;
  finding_id: string | null;
  parent_id: string | null;
  author_id: string;
  author_role: "developer" | "reviewer";
  content: string;
  kind: string;
  created_at: string;
  resolved_at: string | null;
};
export type ReviewDecision = {
  id: string;
  review_id: string;
  reviewer_id: string;
  version: number;
  snapshot_digest: string;
  decision: string;
  scope_ack: boolean;
  observations_ack: boolean;
  evidence_ack: boolean;
  notes: string;
  created_at: string;
};
export type ReviewEvent = {
  id: number;
  review_id: string;
  actor_id: string | null;
  event_type: string;
  metadata: unknown;
  created_at: string;
};
