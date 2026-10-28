import { AuthPage } from "@/features/auth/components/auth-page";
export const metadata = { title: "Forgot password" };
export default async function ForgotPassword({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string }>;
}) {
  return (
    <AuthPage mode="forgot-password" notice={(await searchParams).notice} />
  );
}
export const dynamic = "force-dynamic";
