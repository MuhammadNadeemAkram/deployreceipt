import { AuthPage } from "@/features/auth/components/auth-page";
export const metadata = { title: "Sign in" };
export default async function Login({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string }>;
}) {
  return <AuthPage mode="login" notice={(await searchParams).notice} />;
}
export const dynamic = "force-dynamic";
