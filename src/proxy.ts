import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseConfig, getSiteOrigin } from "@/lib/supabase/config";
import { authDestination } from "@/features/auth/validation";
import { validateEnvironment } from "../server/environment.mjs";
export async function proxy(request: NextRequest) {
  const nonce = btoa(crypto.randomUUID());
  const requestId = crypto.randomUUID();
  const supabase = getSupabaseConfig();
  const policy = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob: ${supabase ? new URL(supabase.url).origin : ""}`,
    `connect-src 'self' ${supabase ? new URL(supabase.url).origin : ""}`,
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
    "form-action 'self'",
  ].join("; ");
  const next = () => {
    const headers = new Headers(request.headers);
    headers.set("x-nonce", nonce);
    headers.set("Content-Security-Policy", policy);
    headers.set("x-request-id", requestId);
    return NextResponse.next({ request: { headers } });
  };
  const finish = (response: NextResponse) => {
    response.headers.set("Content-Security-Policy", policy);
    response.headers.set("x-request-id", requestId);
    response.headers.set("Cache-Control", "private, no-store");
    if (process.env.APP_ENV && process.env.APP_ENV !== "local")
      response.headers.set("Strict-Transport-Security", "max-age=31536000");
    return response;
  };
  let response = next();
  if (
    process.env.VERCEL === "1" ||
    ["staging", "production"].includes(process.env.APP_ENV || "")
  ) {
    try {
      validateEnvironment(process.env);
    } catch {
      return finish(
        new NextResponse("Deployment configuration unavailable.", {
          status: 503,
        }),
      );
    }
    if (
      !request.nextUrl.pathname.startsWith("/api/health") &&
      !request.nextUrl.pathname.startsWith("/api/ready") &&
      request.nextUrl.origin !== getSiteOrigin()
    ) {
      const url = new URL(
        request.nextUrl.pathname + request.nextUrl.search,
        getSiteOrigin(),
      );
      return finish(NextResponse.redirect(url, 307));
    }
  }
  if (["/api/health", "/api/ready"].includes(request.nextUrl.pathname))
    return finish(response);
  const redirect = (notice: string) => {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = notice ? "?notice=" + notice : "";
    const target = NextResponse.redirect(url);
    response.cookies.getAll().forEach((cookie) => target.cookies.set(cookie));
    return finish(target);
  };
  if (!supabase)
    return authDestination(request.nextUrl.pathname)
      ? redirect("")
      : finish(response);
  // Public pages need CSP but no Auth dependency. Refresh all protected routes, including reviews/APIs.
  if (
    !authDestination(request.nextUrl.pathname) &&
    ![
      "/login",
      "/signup",
      "/forgot-password",
      "/reset-password",
      "/auth/callback",
    ].includes(request.nextUrl.pathname)
  )
    return finish(response);
  const client = createServerClient(supabase.url, supabase.key, {
    global: {
      fetch: (input, init) =>
        fetch(input, {
          ...init,
          signal: init?.signal
            ? AbortSignal.any([init.signal, AbortSignal.timeout(10000)])
            : AbortSignal.timeout(10000),
        }),
    },
    cookieOptions: {
      secure: getSiteOrigin().startsWith("https:"),
      httpOnly: true,
      sameSite: "lax",
      path: "/",
    },
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(values) {
        values.forEach(({ name, value }) => request.cookies.set(name, value));
        response = next();
        values.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
      },
    },
  });
  const result = await client.auth.getClaims().catch(() => null);
  if (!result)
    return authDestination(request.nextUrl.pathname)
      ? redirect("service-unavailable")
      : finish(response);
  if (
    authDestination(request.nextUrl.pathname) &&
    (result.error || !result.data?.claims || result.data.claims.is_anonymous)
  )
    return redirect("session-expired");
  return finish(response);
}
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
