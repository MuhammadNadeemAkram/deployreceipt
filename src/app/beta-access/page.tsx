import Link from "next/link";
import { SignOutForm } from "@/features/auth/components/sign-out-form";
export const dynamic = "force-dynamic";
export default function BetaAccess() {
  return (
    <main id="main-content" className="container auth-main">
      <section className="scan-panel">
        <h1>Private beta access</h1>
        <p>
          Your verified account and current session must be approved for this
          environment. Ask the beta operator to approve your email before
          opening a project or client review.
        </p>
        <p>
          Invitation links do not bypass beta admission. Public website scanning
          remains unavailable.
        </p>
        <Link href="/login">Return to sign in</Link>
        <SignOutForm />
      </section>
    </main>
  );
}
