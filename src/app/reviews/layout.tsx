import Link from "next/link";
import { SignOutForm } from "@/features/auth/components/sign-out-form";
export const dynamic = "force-dynamic";
export const metadata = {
  title: "Client review",
  robots: { index: false, follow: false },
};
export default function ClientReviewLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <header className="container review-header">
        <Link className="brand" href="/reviews">
          DeployReceipt · Client review
        </Link>
        <nav aria-label="Client review">
          <Link href="/reviews">My invitations</Link>
          <SignOutForm />
        </nav>
      </header>
      <main id="main-content" className="container review-main">
        {children}
      </main>
    </>
  );
}
