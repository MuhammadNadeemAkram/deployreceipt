import Link from "next/link";
import { getProject } from "@/features/projects/queries";
import { requireUser } from "@/features/auth/session";
import { ScanActions } from "@/features/scans/components/scan-actions";
import { StatusRefresh } from "@/features/scans/components/status-refresh";
export const metadata = { title: "Project scans" };
export default async function ProjectDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const project = await getProject((await params).id);
  const { client } = await requireUser();
  const [verification, history, config, publicStatus] = await Promise.all([
    client
      .from("domain_verifications")
      .select("*")
      .eq("project_id", project.id)
      .maybeSingle(),
    client
      .from("scan_runs")
      .select("*")
      .eq("project_id", project.id)
      .order("created_at", { ascending: false })
      .limit(20),
    client.from("scan_settings").select("*").single(),
    client.rpc("public_scanning_status", {}),
  ]);
  if (verification.error || history.error || config.error)
    throw new Error("Apply the scanning migration before using scan features.");
  const v = verification.data,
    settings = config.data;
  const active =
    history.data?.some((run) => ["queued", "running"].includes(run.status)) ??
    false;
  const verified = Boolean(
    v?.status === "verified" &&
      v.expires_at &&
      new Date(v.expires_at) > new Date(),
  );
  const fixture = /^http:\/\/fixture:8080(\/[^?#]*)?$/.test(
    project.website_url,
  );
  const publicMode = settings?.mode === "public";
  const publicAvailable =
    publicMode &&
    !publicStatus.error &&
    publicStatus.data === true &&
    process.env.APP_ENV === "staging" &&
    process.env.SCANNING_AVAILABLE === "public" &&
    process.env.PUBLIC_SCAN_STAGING === "approved";
  const canScan =
    (publicAvailable && verified && v?.method === "dns" && !active) ||
    (settings?.mode === "local" &&
      fixture &&
      verified &&
      v?.method === "local_fixture" &&
      !active);
  return (
    <>
      <Link href="/dashboard">← Projects</Link>
      <div className="dashboard-title">
        <div>
          <p className="eyebrow">WEBSITE PROJECT</p>
          <h1>{project.name}</h1>
          <p className="project-url">{project.website_url}</p>
        </div>
        <Link
          className="button secondary"
          href={`/dashboard/projects/${project.id}/edit`}
        >
          Edit project
        </Link>
      </div>
      <section className="scan-panel">
        <h2>Website authorization</h2>
        <p>
          <strong>
            {verified
              ? "Verified"
              : v?.status === "pending"
                ? "Verification pending"
                : "Not verified"}
          </strong>
          {v?.verified_at &&
            ` · Last verified ${new Date(v.verified_at).toLocaleString("en", { timeZone: "UTC" })} UTC`}
        </p>
        <p className="notice">
          {publicMode ? (
            publicAvailable ? (
              "Authorized public scanning is available in staging. Scope is the exact verified origin; third-party resources and state-changing methods are blocked. Policy denials are coverage limitations, not automatically website defects."
            ) : (
              "Public scanning is paused. A fresh approved security configuration and healthy isolated gateway/worker are required."
            )
          ) : (
            <>
              Public URL scanning is disabled.{" "}
              {settings?.mode === "local"
                ? "Only the isolated controlled fixture at http://fixture:8080 is permitted."
                : "Scanning is disabled for this installation."}{" "}
              DNS verification does not by itself enable public scans.
            </>
          )}
        </p>
        {fixture && settings?.mode === "local" ? (
          <p>
            The worker can authorize this administrator-provided local fixture.
            This is a test-mode authorization, not proof of public domain
            ownership.
          </p>
        ) : (
          <p>
            Create a challenge, add the TXT record below to your domain’s DNS,
            then recheck. Verification expires after 24 hours and is invalidated
            whenever the project URL changes.
          </p>
        )}
        {v && (
          <dl className="verification-record">
            <dt>DNS TXT name</dt>
            <dd>
              <code>_deployreceipt.{v.domain}</code>
            </dd>
            <dt>DNS TXT value</dt>
            <dd>
              <code>deployreceipt={v.token}</code>
            </dd>
            <dt>Verification expires</dt>
            <dd>{v.expires_at ?? "Not verified"}</dd>
            <dt>Latest check</dt>
            <dd>
              {v.checked_at
                ? new Date(v.checked_at).toISOString()
                : "Waiting for a worker"}
            </dd>
          </dl>
        )}
        <ScanActions
          projectId={project.id}
          canScan={canScan}
          hasChallenge={Boolean(v)}
          publicMode={publicMode}
        />
        {active && (
          <p>
            A scan is already queued or running. The worker will recover an
            expired lease after a crash.
          </p>
        )}
        <StatusRefresh active={active || v?.status === "pending"} />
      </section>
      <section className="scan-panel">
        <h2>Scan history</h2>
        <p className="field-hint">
          Most recent 20 scans. Completed means execution finished; individual
          checks may still fail.
        </p>
        {history.data?.length ? (
          <ul className="scan-history">
            {history.data.map((run) => (
              <li key={run.id}>
                <Link href={`/dashboard/scans/${run.id}`}>
                  Scan {run.id.slice(0, 8)}
                </Link>
                <span className="scan-status" data-status={run.status}>
                  {run.status.replace("_", " ")}
                </span>
                <time dateTime={run.completed_at ?? run.created_at}>
                  {new Date(run.completed_at ?? run.created_at).toISOString()}
                </time>
              </li>
            ))}
          </ul>
        ) : (
          <p>No scans have been requested for this project.</p>
        )}
      </section>
    </>
  );
}
