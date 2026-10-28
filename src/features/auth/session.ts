import "server-only";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseConfig } from "@/lib/supabase/config";

export async function requireUser() {
  if (!getSupabaseConfig()) redirect("/login");
  const client = await createClient();
  // getUser verifies the session with the Auth server, including revoked sessions.
  const result = await client.auth.getUser().catch(() => null);
  if (!result) redirect("/login?notice=service-unavailable");
  const {
    data: { user },
    error,
  } = result;
  if (error || !user || user.is_anonymous)
    redirect("/login?notice=session-expired");
  return { client, user };
}
