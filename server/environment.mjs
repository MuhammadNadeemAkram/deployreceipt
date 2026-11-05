export function validateEnvironment(env) {
  const app = env.APP_ENV || "local",
    hosted = env.VERCEL === "1" || app !== "local";
  if (!["local", "staging", "production"].includes(app))
    throw Error("invalid_environment");
  if (env.VERCEL_ENV === "preview" && app !== "staging")
    throw Error("preview_requires_staging");
  if (app === "production" && env.PRODUCTION_ACTIVATION !== "approved")
    throw Error("production_not_activated");
  const site = env.NEXT_PUBLIC_SITE_URL,
    supa = env.NEXT_PUBLIC_SUPABASE_URL,
    key = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!hosted && !site && !supa && !key)
    return { environment: app, hosted, configured: false, scanning: false };
  if (!site || !supa || !key?.startsWith("sb_publishable_"))
    throw Error("missing_public_configuration");
  const origin = new URL(site),
    database = new URL(supa);
  if (
    origin.username ||
    origin.password ||
    origin.pathname !== "/" ||
    origin.search ||
    origin.hash ||
    database.username ||
    database.password ||
    database.search ||
    database.hash ||
    database.pathname !== "/" ||
    !["http:", "https:"].includes(database.protocol)
  )
    throw Error("invalid_origin");
  if (
    hosted &&
    (origin.protocol !== "https:" ||
      database.protocol !== "https:" ||
      [origin.hostname, database.hostname].some(
        (h) => h === "localhost" || h === "127.0.0.1",
      ))
  )
    throw Error("hosted_https_required");
  if (!hosted && !["http:", "https:"].includes(origin.protocol))
    throw Error("invalid_origin");
  if (
    app === "local" &&
    env.NODE_ENV === "production" &&
    ![origin.hostname, database.hostname].every((h) =>
      ["localhost", "127.0.0.1"].includes(h),
    )
  )
    throw Error("local_production_build_requires_loopback");
  const expected =
    app === "production"
      ? env.PRODUCTION_SUPABASE_PROJECT_REF
      : env.STAGING_SUPABASE_PROJECT_REF;
  if (
    hosted &&
    (!expected ||
      database.hostname !== expected + ".supabase.co" ||
      !env.PRODUCTION_SUPABASE_PROJECT_REF ||
      !env.STAGING_SUPABASE_PROJECT_REF ||
      env.PRODUCTION_SUPABASE_PROJECT_REF === env.STAGING_SUPABASE_PROJECT_REF)
  )
    throw Error("database_environment_mismatch");
  if (
    ![undefined, "disabled", "fixture", "public"].includes(
      env.SCANNING_AVAILABLE,
    )
  )
    throw Error("invalid_scanning_mode");
  if (
    env.SCANNING_AVAILABLE === "public" &&
    (app !== "staging" || env.PUBLIC_SCAN_STAGING !== "approved")
  )
    throw Error("public_scanning_requires_staging_approval");
  return {
    environment: app,
    hosted,
    configured: true,
    scanning: ["fixture", "public"].includes(env.SCANNING_AVAILABLE),
    origin: origin.origin,
    supabaseOrigin: database.origin,
  };
}
