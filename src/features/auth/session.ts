import { cache } from "react";
import "server-only";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseConfig } from "@/lib/supabase/config";

export const requireUser = cache(async () => {
  if (!getSupabaseConfig()) redirect("/login");
  const client = await createClient();
  // Verify identity with Auth; the DB gate also checks live sessions and beta admission.
  const result = await client.auth.getUser().catch(() => null);
  if (!result) redirect("/login?notice=service-unavailable");
  const {
    data: { user },
    error,
  } = result;
  if (error || !user || user.is_anonymous)
    redirect("/login?notice=session-expired");
  const status = await client.rpc("beta_access_status", {});
  if (status.error || !status.data)
    redirect("/login?notice=service-unavailable");
  const beta = status.data as {
    allowed: boolean;
    enforced: boolean;
    environment: string;
  };
  const environment = process.env.APP_ENV || "local";
  if (
    !beta.allowed ||
    (environment !== "local" &&
      (!beta.enforced || beta.environment !== environment))
  )
    redirect("/beta-access");
  return { client, user };
});
