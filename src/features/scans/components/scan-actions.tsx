"use client";
import { useActionState } from "react";
import type { FormState } from "@/features/auth/validation";
import {
  requestPublicScan,
  requestScan,
  requestVerification,
} from "../actions";
export function ScanActions({
  projectId,
  canScan,
  hasChallenge,
  publicMode = false,
}: {
  projectId: string;
  canScan: boolean;
  hasChallenge: boolean;
  publicMode?: boolean;
}) {
  const [verification, verify, verifying] = useActionState(
    requestVerification.bind(null, projectId),
    {} as FormState,
  );
  const [scan, run, starting] = useActionState(
    (publicMode ? requestPublicScan : requestScan).bind(null, projectId),
    {} as FormState,
  );
  return (
    <div className="scan-controls">
      <form action={verify} aria-busy={verifying}>
        <button className="button secondary" disabled={verifying}>
          {verifying
            ? "Queuing…"
            : hasChallenge
              ? "Recheck verification"
              : "Create verification challenge"}
        </button>
        <div aria-live="polite">
          {verification.error && (
            <p className="form-error" role="alert">
              {verification.error}
            </p>
          )}
          {verification.success && (
            <p className="form-success" role="status">
              {verification.success}
            </p>
          )}
        </div>
      </form>
      {canScan && (
        <form action={run} aria-busy={starting}>
          {publicMode && (
            <label className="field-hint">
              <input
                type="checkbox"
                name="consent"
                value="authorized"
                required
              />{" "}
              I own or am authorized to test this exact hostname. I authorize
              bounded, unauthenticated GET/HEAD checks and screenshots. Website
              JavaScript and GET requests can have side effects; third-party
              resources will be blocked.
            </label>
          )}
          <button className="button" disabled={starting}>
            {starting ? "Queuing…" : "Run QA Scan"}
          </button>
          <div aria-live="polite">
            {scan.error && (
              <p className="form-error" role="alert">
                {scan.error}
              </p>
            )}
          </div>
        </form>
      )}
    </div>
  );
}
