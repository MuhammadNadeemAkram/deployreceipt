import { operationalLog } from "@/lib/operations/log";
import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies, headers } from "next/headers";
import { getSupabaseConfig, getSiteOrigin } from "./config";
import type { Database } from "./types";

export async function createClient() {
  const config = getSupabaseConfig();
  if (!config) throw new Error("Supabase is not configured. See .env.example.");
  const store = await cookies();
  const requestId = (await headers()).get("x-request-id") ?? undefined;
  return createServerClient<Database>(config.url, config.key, {
    cookieOptions: {
      secure: getSiteOrigin().startsWith("https:"),
      httpOnly: true,
      sameSite: "lax",
      path: "/",
    },
    global: {
      fetch: async (input, init) => {
        const start = Date.now();
        try {
          const response = await fetch(input, {
            ...init,
            cache: "no-store",
            signal: init?.signal
              ? AbortSignal.any([init.signal, AbortSignal.timeout(10000)])
              : AbortSignal.timeout(10000),
          });
          if (!response.ok || Date.now() - start > 2000)
            operationalLog("dependency_request", {
              request_id: requestId,
              code: response.ok ? "slow" : "http_error",
              duration_ms: Date.now() - start,
            });
          return response;
        } catch {
          operationalLog("dependency_request", {
            request_id: requestId,
            code: "unavailable",
            duration_ms: Date.now() - start,
          });
          throw new Error("Dependency unavailable.");
        }
      },
    },
    cookies: {
      getAll: () => store.getAll(),
      setAll(values) {
        try {
          values.forEach(({ name, value, options }) =>
            store.set(name, value, options),
          );
        } catch {
          // Server Components cannot write cookies. Proxy refreshes them first.
        }
      },
    },
  });
}
