import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSiteOrigin, getSupabaseConfig } from "@/lib/supabase/config";
import { callbackDestination } from "@/features/auth/validation";

export async function GET(request: NextRequest) {
  if (!getSupabaseConfig())
    return new NextResponse("Account services are not configured.", {
      status: 503,
    });
  let origin: string;
  try {
    origin = getSiteOrigin();
  } catch {
    return new NextResponse("Application origin is not configured.", {
      status: 503,
    });
  }
  const params = request.nextUrl.searchParams;
  let destination = "/login?notice=invalid-link";
  try {
    const client = await createClient();
    const code = params.get("code");
    const tokenHash = params.get("token_hash");
    const type = params.get("type");
    if (code && !params.has("error")) {
      const { error } = await client.auth.exchangeCodeForSession(code);
      if (!error) destination = callbackDestination(params.get("next"));
    } else if (
      tokenHash &&
      (type === "email" || type === "recovery") &&
      !params.has("error")
    ) {
      const { error } = await client.auth.verifyOtp({
        token_hash: tokenHash,
        type,
      });
      if (!error)
        destination = type === "recovery" ? "/reset-password" : "/dashboard";
    }
  } catch {
    /* Callback URLs contain short-lived credentials; do not log them. */
  }
  const response = NextResponse.redirect(new URL(destination, origin), 303);
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}
