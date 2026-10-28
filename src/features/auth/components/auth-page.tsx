import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseConfig } from "@/lib/supabase/config";
import { ConfigurationNotice } from "@/components/configuration-notice";
import { AuthForm } from "./auth-form";
import type { AuthMode } from "../validation";
const content: Record<AuthMode, { title: string; description: string }> = {
  login: {
    title: "Welcome back.",
    description: "Sign in to manage your website projects.",
  },
  signup: {
    title: "A clearer place to start.",
    description:
      "Create your DeployReceipt account and organize your website projects.",
  },
  "forgot-password": {
    title: "Reset your password.",
    description: "We’ll email you a link to choose a new password.",
  },
  "reset-password": {
    title: "Choose a new password.",
    description: "Set a unique password for your DeployReceipt account.",
  },
};
const notices: Record<string, string> = {
  "session-expired":
    "Please sign in to continue. Your session may have expired.",
  "password-updated": "Password updated. Sign in with your new password.",
  "signed-out": "You have been signed out.",
  "service-unavailable":
    "Account services could not be reached. Please try again.",
  "invalid-link":
    "This confirmation or reset link is invalid, expired, or already used. Request a new reset link, or submit signup again to request another confirmation.",
};
export async function AuthPage({
  mode,
  notice,
}: {
  mode: AuthMode;
  notice?: string;
}) {
  const configured = Boolean(getSupabaseConfig());
  if (configured) {
    const client = await createClient();
    const result = await client.auth.getUser().catch(() => null);
    const user = result?.data.user;
    if (
      user &&
      !user.is_anonymous &&
      ["login", "signup", "forgot-password"].includes(mode)
    )
      redirect("/dashboard");
    if ((!user || user.is_anonymous) && mode === "reset-password")
      redirect("/forgot-password?notice=invalid-link");
  }
  return (
    <main id="main-content" className="container auth-main">
      <section className="auth-card">
        <p className="eyebrow">YOUR RELEASE WORKSPACE</p>
        <h1>{content[mode].title}</h1>
        <p className="auth-description">{content[mode].description}</p>
        {notice && notices[notice] && (
          <p className="notice" role="status">
            {notices[notice]}
          </p>
        )}
        {configured ? <AuthForm mode={mode} /> : <ConfigurationNotice />}
      </section>
    </main>
  );
}
