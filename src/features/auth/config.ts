export function isLocalSignupEnabled() {
  return (
    process.env.APP_ENV === "local" &&
    process.env.LOCAL_PUBLIC_SIGNUP === "enabled" &&
    process.env.NODE_ENV !== "production" &&
    process.env.VERCEL !== "1"
  );
}
