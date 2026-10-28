"use server";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSiteOrigin, getSupabaseConfig } from "@/lib/supabase/config";
import { validateAuth, type AuthMode, type FormState } from "./validation";

export async function authenticate(
  mode: AuthMode,
  _state: FormState,
  form: FormData,
): Promise<FormState> {
  if (!["login", "signup", "forgot-password", "reset-password"].includes(mode))
    return { error: "Unsupported request." };
  const { email, password, fullName, errors } = validateAuth(mode, form);
  if (Object.keys(errors).length)
    return {
      fieldErrors: errors,
      error: "Please check the highlighted fields.",
    };
  if (!getSupabaseConfig())
    return {
      error:
        "Account services are not configured. Please contact the site administrator.",
    };
  let destination: string | undefined;
  try {
    const client = await createClient();
    if (mode === "login") {
      const { error } = await client.auth.signInWithPassword({
        email,
        password,
      });
      if (error)
        return {
          error:
            "Unable to sign in. Check your credentials and confirm your email, or try again later.",
        };
      destination = "/dashboard";
    } else if (mode === "signup") {
      const { data, error } = await client.auth.signUp({
        email,
        password,
        options: {
          data: { full_name: fullName || null },
          emailRedirectTo: `${getSiteOrigin()}/auth/callback`,
        },
      });
      if (error)
        return {
          error:
            "Unable to create an account. Check your details or try again later.",
        };
      if (data.session) destination = "/dashboard";
      else
        return {
          success:
            "Check your email to confirm your account. If you already have an account, sign in or request a password reset.",
        };
    } else if (mode === "forgot-password") {
      const { error } = await client.auth.resetPasswordForEmail(email, {
        redirectTo: `${getSiteOrigin()}/auth/callback?next=/reset-password`,
      });
      if (error)
        return {
          error: "Unable to request a reset right now. Please try again later.",
        };
      return {
        success:
          "If an account exists for that address, a password reset email is on its way. Open the link in this browser.",
      };
    } else {
      const {
        data: { user },
        error,
      } = await client.auth.getUser();
      if (error || !user || user.is_anonymous)
        return {
          error:
            "Your reset session has expired. Request a new password reset link.",
        };
      const result = await client.auth.updateUser({ password });
      if (result.error)
        return {
          error:
            "Unable to update your password. Use a different password or request a fresh reset link.",
        };
      const signOut = await client.auth.signOut({ scope: "global" });
      if (signOut.error)
        return {
          success:
            "Password updated. Sign out and sign back in with your new password.",
        };
      destination = "/login?notice=password-updated";
    }
  } catch {
    return {
      error:
        "Account services are temporarily unavailable or misconfigured. Please try again later.",
    };
  }
  if (destination) redirect(destination);
  return { error: "Unable to complete the request." };
}

export async function signOut(): Promise<FormState> {
  try {
    const client = await createClient();
    const { error } = await client.auth.signOut();
    if (error) return { error: "Unable to sign out. Please try again." };
  } catch {
    return { error: "Unable to sign out. Please try again." };
  }
  redirect("/login?notice=signed-out");
}
