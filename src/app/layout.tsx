import type { Metadata } from "next";
import { site } from "@/lib/site";
import "./globals.css";
export const metadata: Metadata = {
  title: {
    default: "DeployReceipt — Test. Review. Approve. Ship.",
    template: "%s | DeployReceipt",
  },
  description: site.description,
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <a className="skip-link" href="#main-content">
          Skip to content
        </a>
        {children}
      </body>
    </html>
  );
}
