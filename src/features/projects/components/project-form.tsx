"use client";
import { useActionState } from "react";
import Link from "next/link";
import { saveProject } from "../actions";
import type { Project } from "@/lib/supabase/types";
import type { FormState } from "@/features/auth/validation";

export function ProjectForm({ project }: { project?: Project }) {
  const [state, action, pending] = useActionState(
    saveProject.bind(null, project?.id ?? null),
    {} as FormState,
  );
  return (
    <form action={action} className="stack-form" aria-busy={pending}>
      <div className="field">
        <label htmlFor="name">Project name</label>
        <input
          id="name"
          name="name"
          required
          maxLength={120}
          defaultValue={project?.name}
          aria-invalid={Boolean(state.fieldErrors?.name)}
          aria-describedby="name-error"
        />
        <p id="name-error" className="field-error">
          {state.fieldErrors?.name}
        </p>
      </div>
      <div className="field">
        <label htmlFor="website_url">Website URL</label>
        <input
          id="website_url"
          name="website_url"
          type="url"
          required
          maxLength={2048}
          placeholder="https://example.com"
          defaultValue={project?.website_url}
          aria-invalid={Boolean(state.fieldErrors?.website_url)}
          aria-describedby="website-help website-error"
        />
        <p className="field-hint" id="website-help">
          HTTP or HTTPS only. Saving a URL does not scan or contact the website.
        </p>
        <p id="website-error" className="field-error">
          {state.fieldErrors?.website_url}
        </p>
      </div>
      <div className="field">
        <label htmlFor="description">Description (optional)</label>
        <textarea
          id="description"
          name="description"
          rows={4}
          maxLength={2000}
          defaultValue={project?.description ?? ""}
          aria-invalid={Boolean(state.fieldErrors?.description)}
          aria-describedby="description-error"
        />
        <p id="description-error" className="field-error">
          {state.fieldErrors?.description}
        </p>
      </div>
      <div aria-live="polite">
        {state.error && (
          <p className="form-error" role="alert">
            {state.error}
          </p>
        )}
      </div>
      <div className="actions">
        <button className="button" disabled={pending} type="submit">
          {pending ? "Saving…" : project ? "Save changes" : "Create project"}
        </button>
        <Link className="button secondary" href="/dashboard">
          Cancel
        </Link>
      </div>
    </form>
  );
}
