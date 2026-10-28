export function getSupabaseConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return null;
  try {
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol)) return null;
    // Reject server secrets even if mistakenly assigned to the public variable.
    if (key.startsWith("sb_secret_")) return null;
    if (!key.startsWith("sb_publishable_")) return null;
    return { url, key };
  } catch {
    return null;
  }
}

export function getSiteOrigin() {
  const value = process.env.NEXT_PUBLIC_SITE_URL;
  if (!value)
    throw new Error("Set NEXT_PUBLIC_SITE_URL to your application origin.");
  const url = new URL(value);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error("NEXT_PUBLIC_SITE_URL must be an HTTP(S) origin.");
  }
  if (
    process.env.NODE_ENV === "production" &&
    url.protocol !== "https:" &&
    !["localhost", "127.0.0.1"].includes(url.hostname)
  ) {
    throw new Error("Production requires an HTTPS application origin.");
  }
  return url.origin;
}
