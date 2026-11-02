"use client";
import { useActionState } from "react";
import { createReport } from "../actions";
import type { FormState } from "@/features/auth/validation";
export function CreateReport({
  scanId,
  diagnostic,
}: {
  scanId: string;
  diagnostic: boolean;
}) {
  const [state, action, pending] = useActionState(
    createReport.bind(null, scanId),
    {} as FormState,
  );
  return (
    <form action={action} aria-busy={pending}>
      <button className="button" disabled={pending}>
        {pending
          ? "Preparing…"
          : diagnostic
            ? "Create diagnostic report"
            : "Create / open QA report"}
      </button>
      {state.error && (
        <p className="form-error" role="alert">
          {state.error}
        </p>
      )}
    </form>
  );
}
