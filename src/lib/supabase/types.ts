import type {
  ReleaseReview,
  ReviewInvitation,
  ReviewEvidence,
  ReviewComment,
  ReviewDecision,
  ReviewEvent,
} from "@/features/releases/types";
import type {
  ScanRun,
  ScanCheck,
  ScanSettings,
  Verification,
} from "@/features/scans/types";
import type {
  ReportRecord,
  Triage,
  Comment,
  EvidenceLink,
} from "@/features/reports/types";
type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];
type ReadTable<T> = { Row: T; Insert: never; Update: never; Relationships: [] };
// Schema contract for supabase/migrations. Regenerate with Supabase CLI after schema changes.
export type Project = {
  id: string;
  owner_id: string;
  name: string;
  website_url: string;
  description: string | null;
  created_at: string;
  updated_at: string;
};
type Profile = {
  id: string;
  full_name: string | null;
  created_at: string;
  updated_at: string;
};
export type Database = {
  public: {
    Tables: {
      release_reviews: ReadTable<ReleaseReview>;
      review_invitations: ReadTable<ReviewInvitation>;
      release_review_evidence: ReadTable<ReviewEvidence>;
      review_comments: ReadTable<ReviewComment>;
      review_decisions: ReadTable<ReviewDecision>;
      review_events: ReadTable<ReviewEvent>;
      qa_reports: ReadTable<ReportRecord>;
      qa_finding_triage: ReadTable<Triage>;
      qa_comments: ReadTable<Comment>;
      qa_finding_evidence: ReadTable<EvidenceLink>;
      scan_runs: ReadTable<ScanRun>;
      scan_checks: ReadTable<ScanCheck>;
      domain_verifications: ReadTable<Verification>;
      scan_settings: ReadTable<ScanSettings>;
      profiles: {
        Row: Profile;
        Insert: { id: string; full_name?: string | null };
        Update: { full_name?: string | null };
        Relationships: [];
      };
      projects: {
        Row: Project;
        Insert: {
          name: string;
          website_url: string;
          description?: string | null;
        };
        Update: {
          name?: string;
          website_url?: string;
          description?: string | null;
        };
        Relationships: [];
      };
    };
    Views: { [_ in never]: never };
    Functions: {
      create_release_review: {
        Args: {
          p_report: string;
          p_title: string;
          p_notes: string;
          p_email: string;
          p_previous: string | null;
        };
        Returns: string;
      };
      expire_release_reviews: {
        Args: Record<string, never>;
        Returns: undefined;
      };
      manage_release_review: {
        Args: { p_id: string; p_action: string };
        Returns: string;
      };
      accept_review_invitation: {
        Args: { p_invitation: string };
        Returns: string;
      };
      add_review_comment: {
        Args: {
          p_id: string;
          p_content: string;
          p_finding: string | null;
          p_parent: string | null;
          p_kind: string;
        };
        Returns: string;
      };
      resolve_review_feedback: {
        Args: { p_id: string; p_comment: string; p_resolved: boolean };
        Returns: undefined;
      };
      decide_release_review: {
        Args: {
          p_id: string;
          p_version: number;
          p_digest: string;
          p_decision: string;
          p_scope_ack: boolean;
          p_observations_ack: boolean;
          p_evidence_ack: boolean;
          p_notes: string;
        };
        Returns: string;
      };
      can_read_release_artifact: {
        Args: { p_review: string; p_check: string };
        Returns: boolean;
      };
      can_read_review_evidence: { Args: { p_path: string }; Returns: boolean };
      record_scan_configuration: {
        Args: { p_scan_id: string; p_lease: string; p_configuration: Json };
        Returns: boolean;
      };
      create_qa_report: { Args: { p_scan_id: string }; Returns: string };
      save_qa_triage: {
        Args: {
          p_report_id: string;
          p_check_id: string;
          p_severity: string | null;
          p_resolution: string;
          p_notes: string;
          p_revision: number;
          p_evidence: string[];
        };
        Returns: undefined;
      };
      add_qa_comment: {
        Args: { p_report_id: string; p_check_id: string; p_body: string };
        Returns: string;
      };
      claim_qa_export: { Args: { p_report_id: string }; Returns: string };
      release_qa_export: { Args: { p_token: string }; Returns: undefined };
      request_scan: { Args: { p_project_id: string }; Returns: string };
      request_domain_verification: {
        Args: { p_project_id: string };
        Returns: undefined;
      };
      lease_scan_job: { Args: Record<string, never>; Returns: Json };
      finish_scan: {
        Args: {
          p_scan_id: string;
          p_lease: string;
          p_status: string;
          p_checks: Json;
          p_error?: string | null;
        };
        Returns: boolean;
      };
      retry_scan: {
        Args: { p_scan_id: string; p_lease: string };
        Returns: boolean;
      };
      finish_verification: {
        Args: {
          p_project_id: string;
          p_lease: string;
          p_verified: boolean;
          p_method: string;
        };
        Returns: boolean;
      };
      ack_scan_job: { Args: { p_message_id: string }; Returns: boolean };
      expired_scan_artifacts: {
        Args: Record<string, never>;
        Returns: string[];
      };
    };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
};
