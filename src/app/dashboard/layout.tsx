import { WorkspaceNav } from "@/components/layout/workspace-nav";
import Link from "next/link";
import { getSupabaseConfig } from "@/lib/supabase/config";
import { requireUser } from "@/features/auth/session";
import { SignOutForm } from "@/features/auth/components/sign-out-form";
import { ConfigurationNotice } from "@/components/configuration-notice";
export const metadata = {
  title: "Projects",
  robots: { index: false, follow: false },
};
export const dynamic = "force-dynamic";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  if (!getSupabaseConfig())
    return (
      <main id="main-content" className="container auth-main">
        <ConfigurationNotice />
      </main>
    );
  const { user } = await requireUser();
  return (
    <div className="workspace">
      <aside className="sidebar">
        <Link className="brand" href="/">
          <span className="mark" aria-hidden="true">
            ✓
          </span>
          DeployReceipt
        </Link>
        <p className="eyebrow">YOUR WORKSPACE</p>
        <WorkspaceNav />
        <p className="sidebar-note">
          {process.env.SCANNING_AVAILABLE === "public"
            ? "Public staging mode requires verified ownership and current security readiness. Private reports and versioned reviews remain access-controlled."
            : "Private projects, controlled-fixture scans, QA reports and versioned client reviews. Public scanning remains unavailable for this configuration."}
        </p>
      </aside>
      <div className="workspace-body">
        <header className="workspace-header">
          <span>
            Private beta ·{" "}
            {process.env.SCANNING_AVAILABLE === "public"
              ? "Authorized public scans · staging security gates apply"
              : process.env.SCANNING_AVAILABLE === "fixture"
                ? "Restricted fixture scans only"
                : "Scanning disabled"}
          </span>
          <details className="account-menu">
            <summary>My account</summary>
            <div>
              <p className="account-email">{user.email}</p>
              <Link href="/reset-password">Change password</Link>
              <SignOutForm />
            </div>
          </details>
        </header>
        <main id="main-content" className="dashboard-content">
          {children}
        </main>
      </div>
    </div>
  );
}
