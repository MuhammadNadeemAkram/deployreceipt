"use client";
import { useActionState } from "react";
import Link from "next/link";
import { authenticate } from "../actions";
import type { AuthMode, FormState } from "../validation";
const labels: Record<AuthMode, string> = {
  login: "Sign in",
  signup: "Create account",
  "forgot-password": "Send reset link",
  "reset-password": "Set new password",
};

export function AuthForm({ mode }: { mode: AuthMode }) {
  const [state, action, pending] = useActionState(
    authenticate.bind(null, mode),
    {} as FormState,
  );
  const fields = [
    ...(mode === "signup"
      ? [
          {
            name: "full_name",
            label: "Full name (optional)",
            type: "text",
            autoComplete: "name",
            max: 120,
          },
        ]
      : []),
    ...(mode !== "reset-password"
      ? [
          {
            name: "email",
            label: "Email address",
            type: "email",
            autoComplete: "email",
            max: 254,
          },
        ]
      : []),
    ...(mode !== "forgot-password"
      ? [
          {
            name: "password",
            label: mode === "reset-password" ? "New password" : "Password",
            type: "password",
            autoComplete:
              mode === "login" ? "current-password" : "new-password",
            max: 128,
          },
        ]
      : []),
    ...(["signup", "reset-password"].includes(mode)
      ? [
          {
            name: "confirm_password",
            label: "Confirm password",
            type: "password",
            autoComplete: "new-password",
            max: 128,
          },
        ]
      : []),
  ];
  return (
    <form action={action} className="stack-form" aria-busy={pending}>
      {fields.map((field) => (
        <div className="field" key={field.name}>
          <label htmlFor={field.name}>{field.label}</label>
          <input
            id={field.name}
            name={field.name}
            type={field.type}
            autoComplete={field.autoComplete}
            maxLength={field.max}
            minLength={
              field.type === "password" && mode !== "login" ? 12 : undefined
            }
            required={field.name !== "full_name"}
            aria-invalid={Boolean(state.fieldErrors?.[field.name])}
            aria-describedby={
              state.fieldErrors?.[field.name]
                ? `${field.name}-error`
                : field.name === "password" && mode !== "login"
                  ? "password-help"
                  : undefined
            }
          />
          {state.fieldErrors?.[field.name] && (
            <p className="field-error" id={`${field.name}-error`}>
              {state.fieldErrors[field.name]}
            </p>
          )}
          {field.name === "password" && mode !== "login" && (
            <p className="field-hint" id="password-help">
              Use 12–128 characters. A unique passphrase works well.
            </p>
          )}
        </div>
      ))}
      <div aria-live="polite" aria-atomic="true">
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
      <button className="button" type="submit" disabled={pending}>
        {pending ? "Please wait…" : labels[mode]}
      </button>
      <div className="auth-links">
        {mode === "login" ? (
          <>
            <Link href="/forgot-password">Forgot password?</Link>
            <Link href="/signup">Create an account</Link>
          </>
        ) : (
          <Link href="/login">Back to sign in</Link>
        )}
      </div>
    </form>
  );
}
