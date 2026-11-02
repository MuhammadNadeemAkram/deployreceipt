"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
export function WorkspaceNav() {
  const pathname = usePathname() ?? "";
  const items = [
    {
      href: "/dashboard",
      label: "Projects",
      active:
        pathname === "/dashboard" ||
        pathname.startsWith("/dashboard/scans/") ||
        (pathname.startsWith("/dashboard/projects/") &&
          pathname !== "/dashboard/projects/new"),
    },
    {
      href: "/dashboard/projects/new",
      label: "New project",
      active: pathname === "/dashboard/projects/new",
    },
    {
      href: "/dashboard/reports",
      label: "QA reports",
      active: pathname.startsWith("/dashboard/reports"),
    },
    { href: "/", label: "Product home", active: false },
  ];
  return (
    <nav aria-label="Workspace navigation">
      {items.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          className={item.active ? "sidebar-link" : undefined}
          aria-current={item.active ? "page" : undefined}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
