import { AuthPage } from "@/features/auth/components/auth-page";
export const metadata = { title: "Set new password" };
export default function ResetPassword() {
  return <AuthPage mode="reset-password" />;
}
export const dynamic = "force-dynamic";
