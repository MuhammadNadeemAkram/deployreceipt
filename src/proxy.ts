import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseConfig } from "@/lib/supabase/config";
import { authDestination } from "@/features/auth/validation";

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  const config = getSupabaseConfig();
  if (!config) {
    if (authDestination(request.nextUrl.pathname)) {
      const url = request.nextUrl.clone();
      url.pathname = "/login";
      url.search = "";
      const redirect = NextResponse.redirect(url);
      redirect.headers.set("Cache-Control", "private, no-store");
      return redirect;
    }
    return response;
  }
  const client = createServerClient(config.url, config.key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(values) {
        values.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        values.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
      },
    },
  });
  const result = await client.auth.getClaims().catch(() => null);
  if (!result) {
    if (authDestination(request.nextUrl.pathname)) {
      const url = request.nextUrl.clone();
      url.pathname = "/login";
      url.search = "?notice=service-unavailable";
      const redirect = NextResponse.redirect(url);
      response.cookies
        .getAll()
        .forEach((cookie) => redirect.cookies.set(cookie));
      redirect.headers.set("Cache-Control", "private, no-store");
      return redirect;
    }
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  }
  const { data, error } = result;
  if (
    authDestination(request.nextUrl.pathname) &&
    (error || !data?.claims || data.claims.is_anonymous)
  ) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "?notice=session-expired";
    const redirect = NextResponse.redirect(url);
    response.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie));
    redirect.headers.set("Cache-Control", "private, no-store");
    return redirect;
  }
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/login",
    "/signup",
    "/forgot-password",
    "/reset-password",
    "/auth/:path*",
  ],
};
