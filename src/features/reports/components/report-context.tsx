import type { ScanRun } from "@/features/scans/types";
export function ConfigurationSummary({ scan }: { scan: ScanRun }) {
  const value = scan.configuration_snapshot;
  if (!value)
    return <>Not recorded. Current settings have not been substituted.</>;
  const parts = [
    value.mode === "local"
      ? "Controlled fixture mode"
      : `Mode: ${String(value.mode ?? "not recorded")}`,
    `Desktop: ${String(value.desktop_viewport ?? "not recorded")}`,
    `Mobile: ${String(value.mobile_viewport ?? "not recorded")}`,
    `Internal link limit: ${String(value.max_links ?? "not recorded")}`,
    `Request limit: ${String(value.max_requests ?? "not recorded")}`,
    `Execution limit: ${String(value.timeout_seconds ?? "not recorded")} seconds`,
  ];
  return (
    <>
      {parts.join(" · ")}
      <details>
        <summary>Full configuration record</summary>
        <pre className="scan-details">{JSON.stringify(value, null, 2)}</pre>
      </details>
    </>
  );
}
export function AuthorizationSummary({ scan }: { scan: ScanRun }) {
  const value = scan.verification_snapshot;
  if (!value)
    return (
      <>
        Not recorded for this historical scan; this is the stored target URL,
        not a new verification claim.
      </>
    );
  return (
    <>
      {value.method === "local_fixture"
        ? "Administrator-authorized controlled fixture"
        : value.method === "dns"
          ? "DNS TXT ownership verified"
          : "Recorded authorization"}{" "}
      · Domain: {String(value.domain ?? "not recorded")} · Verified at{" "}
      {String(value.verified_at ?? "not recorded")}. This records authorization
      at the scan request, not a fresh domain check.
    </>
  );
}
