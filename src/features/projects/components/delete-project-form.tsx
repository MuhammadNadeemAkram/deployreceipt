"use client";
import { useActionState } from "react";
import Link from "next/link";
import { deleteProject } from "../actions";
import type { FormState } from "@/features/auth/validation";

export function DeleteProjectForm({ id }: { id: string }) {
  const [state, action, pending] = useActionState(
    deleteProject.bind(null, id),
    {} as FormState,
  );
  return (
    <form action={action} className="stack-form" aria-busy={pending}>
      <label className="checkbox-label">
        <input name="confirmation" value="delete" type="checkbox" required />I
        understand this permanently deletes the project.
      </label>
      <div aria-live="polite">
        {state.error && (
          <p className="form-error" role="alert">
            {state.error}
          </p>
        )}
      </div>
      <div className="actions">
        <button className="button danger" type="submit" disabled={pending}>
          {pending ? "Deleting…" : "Delete project"}
        </button>
        <Link className="button secondary" href="/dashboard">
          Keep project
        </Link>
      </div>
    </form>
  );
}
