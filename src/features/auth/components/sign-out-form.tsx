"use client";
import { useActionState } from "react";
import { signOut } from "../actions";
import type { FormState } from "../validation";
export function SignOutForm() {
  const [state, action, pending] = useActionState(signOut, {} as FormState);
  return (
    <form action={action}>
      <button
        className="button secondary small"
        disabled={pending}
        type="submit"
      >
        {pending ? "Signing out…" : "Sign out"}
      </button>
      {state.error && (
        <p className="field-error" role="alert">
          {state.error}
        </p>
      )}
    </form>
  );
}
