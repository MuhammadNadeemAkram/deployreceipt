import { createClient } from "@supabase/supabase-js";
import { deployment } from "@/lib/operations/environment";
import { getSupabaseConfig } from "@/lib/supabase/config";
import { operationalLog } from "@/lib/operations/log";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  let ready = false;
  try {
    const env = deployment(),
      config = getSupabaseConfig();
    if (env.configured && config) {
      const client = createClient(config.url, config.key, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const result = await client
        .rpc("beta_readiness", {
          p_environment: env.environment,
          p_scanning: env.scanning,
        })
        .abortSignal(AbortSignal.timeout(5000));
      ready = !result.error && result.data === true;
    }
  } catch {
    /* Never expose dependency or configuration details. */
  }
  operationalLog("readiness_checked", {
    request_id: request.headers.get("x-request-id") ?? undefined,
    code: ready ? "ready" : "unavailable",
  });
  return Response.json(
    { ready },
    { status: ready ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
