"use client";
import { useActionState, useState } from "react";
import { saveTriage, addComment } from "../actions";
import { severities, resolutions } from "../model";
import type { FormState } from "@/features/auth/validation";
import type { Triage, EvidenceState } from "../types";
export function FindingTriageForm({
  triage,
  evidence,
  attached,
}: {
  triage: Triage;
  evidence: EvidenceState[];
  attached: string[];
}) {
  const [state, action, pending] = useActionState(
    saveTriage.bind(null, triage.report_id, triage.scan_check_id),
    {} as FormState,
  );
  const [severity, setSeverity] = useState(triage.severity ?? "");
  const [resolution, setResolution] = useState(triage.resolution);
  const [notes, setNotes] = useState(triage.notes);
  const [selected, setSelected] = useState(attached);
  const prefix = triage.scan_check_id;
  return (
    <form
      action={action}
      className="stack-form report-triage"
      aria-busy={pending}
    >
      <input type="hidden" name="revision" value={triage.revision} />
      <div className="triage-grid">
        <div className="field">
          <label htmlFor={prefix + "-severity"}>Human-triaged severity</label>
          <select
            id={prefix + "-severity"}
            name="severity"
            value={severity}
            onChange={(event) => setSeverity(event.target.value)}
          >
            <option value="">Untriaged</option>
            {severities.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
          {state.fieldErrors?.severity && (
            <p className="field-error" role="alert">
              {state.fieldErrors.severity}
            </p>
          )}
        </div>
        <div className="field">
          <label htmlFor={prefix + "-status"}>Resolution status</label>
          <select
            id={prefix + "-status"}
            name="resolution"
            value={resolution}
            onChange={(event) =>
              setResolution(event.target.value as Triage["resolution"])
            }
          >
            {resolutions.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="field">
        <label htmlFor={prefix + "-notes"}>Developer notes</label>
        <textarea
          id={prefix + "-notes"}
          name="notes"
          rows={3}
          maxLength={2000}
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          aria-invalid={Boolean(state.fieldErrors?.notes)}
          aria-describedby={prefix + "-notes-help"}
        />
        <p id={prefix + "-notes-help"} className="field-hint">
          Plain text, up to 2,000 characters. Automated observations remain
          unchanged.
        </p>
      </div>
      {evidence.length > 0 && (
        <fieldset className="evidence-options">
          <legend>Supporting screenshots</legend>
          {evidence.map((item) => (
            <label className="checkbox-label" key={item.checkId}>
              <input
                type="checkbox"
                name="evidence"
                value={item.checkId}
                checked={selected.includes(item.checkId)}
                disabled={
                  item.state !== "available" && !attached.includes(item.checkId)
                }
                onChange={(event) =>
                  setSelected((values) =>
                    event.target.checked
                      ? [...values, item.checkId]
                      : values.filter((value) => value !== item.checkId),
                  )
                }
              />
              {item.type} capture{" "}
              {item.state !== "available" && `(${item.state}; reference only)`}
            </label>
          ))}
          <p className="field-hint">
            Use existing scan evidence only. Attaching it does not extend
            retention.
          </p>
        </fieldset>
      )}
      <div aria-live="polite">
        {state.error && (
          <p className="form-error" role="alert">
            {state.error}
          </p>
        )}
        {state.success && (
          <p className="form-success" role="status">
            {state.success}
          </p>
        )}
      </div>
      <button className="button small" disabled={pending}>
        {pending ? "Saving…" : "Save triage"}
      </button>
    </form>
  );
}
export function FindingCommentForm({
  reportId,
  checkId,
}: {
  reportId: string;
  checkId: string;
}) {
  const [state, action, pending] = useActionState(
    addComment.bind(null, reportId, checkId),
    {} as FormState,
  );
  const [body, setBody] = useState("");
  return (
    <form action={action} className="stack-form" aria-busy={pending}>
      <div className="field">
        <label htmlFor={checkId + "-comment"}>Add developer comment</label>
        <textarea
          id={checkId + "-comment"}
          name="comment"
          rows={2}
          maxLength={2000}
          required
          value={body}
          onChange={(event) => setBody(event.target.value)}
        />
        <p className="field-hint">
          Comments are append-only. Maximum 30 comments per report.
        </p>
      </div>
      <div aria-live="polite">
        {state.error && (
          <p className="form-error" role="alert">
            {state.error}
          </p>
        )}
        {state.success && (
          <p className="form-success" role="status">
            {state.success}
          </p>
        )}
      </div>
      <button className="button secondary small" disabled={pending}>
        {pending ? "Adding…" : "Add comment"}
      </button>
    </form>
  );
}
