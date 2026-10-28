export type FormState = {
  error?: string;
  success?: string;
  fieldErrors?: Record<string, string>;
};
export type AuthMode =
  "login" | "signup" | "forgot-password" | "reset-password";

export function text(form: FormData, field: string) {
  const value = form.get(field);
  return typeof value === "string" ? value : "";
}

export function validateAuth(mode: AuthMode, form: FormData) {
  const email = text(form, "email").trim().toLowerCase();
  const password = text(form, "password");
  const fullName = text(form, "full_name").trim();
  const errors: Record<string, string> = {};
  if (
    mode !== "reset-password" &&
    (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254)
  ) {
    errors.email = "Enter a valid email address.";
  }
  if (mode !== "forgot-password") {
    const minimum = mode === "login" ? 1 : 12;
    if (password.length < minimum || password.length > 128)
      errors.password =
        mode === "login"
          ? "Enter your password (up to 128 characters)."
          : "Use a password between 12 and 128 characters.";
  }
  if (
    (mode === "signup" || mode === "reset-password") &&
    password !== text(form, "confirm_password")
  )
    errors.confirm_password = "Passwords do not match.";
  if (mode === "signup" && fullName.length > 120)
    errors.full_name = "Use 120 characters or fewer.";
  return { email, password, fullName, errors };
}

export function authDestination(path: string) {
  return path === "/dashboard" || path.startsWith("/dashboard/");
}

export function callbackDestination(value: string | null) {
  return value === "/reset-password" ? "/reset-password" : "/dashboard";
}
