import "server-only";
export function operationalLog(
  event: string,
  fields: { request_id?: string; code?: string; duration_ms?: number } = {},
) {
  if (
    process.env.OPERATIONAL_LOGS !== "enabled" ||
    !["readiness_checked", "dependency_request"].includes(event)
  )
    return;
  console.info(
    JSON.stringify({
      event,
      request_id: fields.request_id?.match(/^[a-f0-9-]{36}$/i)
        ? fields.request_id
        : undefined,
      code: fields.code?.match(/^[a-z_]{1,40}$/) ? fields.code : undefined,
      duration_ms:
        typeof fields.duration_ms === "number"
          ? Math.round(fields.duration_ms)
          : undefined,
    }),
  );
}
