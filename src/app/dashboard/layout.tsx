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
          Private projects, controlled-fixture scans, and QA reports. Public
          scanning and client approvals remain unavailable.
        </p>
      </aside>
      <div className="workspace-body">
        <header className="workspace-header">
          <span>Personal workspace</span>
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
