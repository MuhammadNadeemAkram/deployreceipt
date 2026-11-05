// Read-only smoke checks. Configure a protected staging environment; never accept a target from a PR.
const origin = new URL(process.env.STAGING_SITE_ORIGIN || "");
if (
  origin.protocol !== "https:" ||
  origin.username ||
  origin.password ||
  origin.pathname !== "/" ||
  origin.search ||
  origin.hash
)
  throw Error("Invalid staging origin");
const headers = process.env.VERCEL_AUTOMATION_BYPASS_SECRET
  ? {
      "x-vercel-protection-bypass": process.env.VERCEL_AUTOMATION_BYPASS_SECRET,
    }
  : {};
for (const path of ["/api/health", "/api/ready"]) {
  const response = await fetch(new URL(path, origin), {
    headers,
    redirect: "manual",
    signal: AbortSignal.timeout(15000),
  });
  if (
    response.status !== 200 ||
    response.headers.get("x-content-type-options") !== "nosniff" ||
    !response.headers.get("x-request-id")
  )
    throw Error("Staging health check failed");
  const body = await response.json();
  if (path.endsWith("health") ? body.status !== "ok" : body.ready !== true)
    throw Error("Staging readiness failed");
}
const denied = await fetch(new URL("/dashboard", origin), {
  headers,
  redirect: "manual",
  signal: AbortSignal.timeout(15000),
});
if (
  denied.status !== 307 ||
  new URL(denied.headers.get("location"), origin).pathname !== "/login"
)
  throw Error("Unauthenticated gate failed");
console.info(JSON.stringify({ event: "staging_smoke_passed", checks: 3 }));
