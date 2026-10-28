import { AuthPage } from "@/features/auth/components/auth-page";
export const metadata = { title: "Create account" };
export default function Signup() {
  return <AuthPage mode="signup" />;
}
export const dynamic = "force-dynamic";
