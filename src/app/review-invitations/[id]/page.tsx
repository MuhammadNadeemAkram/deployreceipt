import Link from "next/link";
import { isId } from "@/features/reports/model";
import { notFound } from "next/navigation";
import { AcceptInvitationForm } from "@/features/releases/components/forms";
export const dynamic = "force-dynamic";
export const metadata = {
  title: "Review invitation",
  robots: { index: false, follow: false },
};
export default async function ReviewInvitationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!isId(id)) notFound();
  return (
    <main id="main-content" className="container auth-main">
      <section className="report-panel">
        <p className="eyebrow">DEPLOYRECEIPT · PRIVATE INVITATION</p>
        <h1>Review a specific release.</h1>
        <p>
          Sign in with the verified email invited by the developer. This page
          reveals no private report content. If you need an account, sign up and
          confirm your email first, then reopen this link or choose Client
          reviews in your workspace.
        </p>
        <p>
          <Link href="/login">Sign in</Link> ·{" "}
          <Link href="/signup">Create an account</Link> ·{" "}
          <Link href="/reviews">My invitations</Link>
        </p>
        <AcceptInvitationForm id={id} />
      </section>
    </main>
  );
}
