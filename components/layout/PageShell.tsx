"use client";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { ThemeToggleButton } from "@/components/theme/ThemeToggleButton";
import { KloudtrackEnvironmentSwitch } from "@/components/telemetry/KloudtrackEnvironmentSwitch";

export type PageNavLink = {
  href: string;
  label: string;
};

const PRIMARY_NAV_LINKS: PageNavLink[] = [
  { href: "/", label: "Dashboard" },
  { href: "/pubmat", label: "Daily Readings" },
];

const SECONDARY_NAV_LINKS: PageNavLink[] = [
  { href: "/config", label: "Metric Config" },
  { href: "/architecture", label: "Architecture" },
  { href: "/debug/ai-context", label: "AI Context Viewer" },
];

type PageShellProps = {
  eyebrow: string;
  title: string;
  description?: ReactNode;
  children: ReactNode;
};

export function PageShell({ eyebrow, title, description, children }: PageShellProps) {
  const pathname = usePathname();

  return (
    <div className="min-h-screen bg-background px-5 py-6 text-foreground">
      <div className="mx-auto flex min-h-[calc(100vh-48px)] max-w-365 flex-col">

        {/* Page header */}
        <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-label-strong">{eyebrow}</p>
            <h1 className="mt-2 text-3xl font-semibold">{title}</h1>
            {description ? (
              <div className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">{description}</div>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <nav className="flex flex-wrap gap-2">
              {PRIMARY_NAV_LINKS.map((link) => (
                <Link
                  aria-current={isActiveLink(pathname, link.href) ? "page" : undefined}
                  className={isActiveLink(pathname, link.href) ? "nav-pill nav-pill-active" : "nav-pill"}
                  href={link.href}
                  key={link.href}
                >
                  {link.label}
                </Link>
              ))}
            </nav>
            <KloudtrackEnvironmentSwitch />
            <ThemeToggleButton />
          </div>
        </div>

        {/* Main content */}
        <main className="flex-1 px-8">{children}</main>

        {/* Footer */}
        <footer className="mt-12 border-t border-border">
          <div className="flex flex-col gap-6 py-6 sm:flex-row sm:items-start sm:justify-between">

            {/* Brand block */}
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-2.5">
                <div className="relative h-7 w-7 overflow-hidden rounded-md ">
                  <Image
                    src="/kloudvestigate_logo.png"
                    alt="Kloudvestigate logo"
                    fill
                    className="object-contain p-1"
                    onError={(e) => {
                      // Fallback monogram while logo is pending
                      (e.target as HTMLImageElement).style.display = "none";
                    }}
                  />
                  {/* Monogram fallback */}
                  {/* <span className="absolute inset-0 flex items-center justify-center text-xs font-bold text-brand-faint">
                    K
                  </span> */}
                </div>
                <span className="text-sm font-semibold tracking-tight text-foreground">Kloudvestigate</span>
              </div>
              <p className="max-w-56 text-xs leading-5 text-footer-foreground">
                Daily telemetry investigation across all stations.
              </p>
            </div>

            {/* Footer nav */}
            <div className="flex flex-col gap-2">
              <p className="text-lg font-semibold uppercase tracking-[0.14em] text-footer-foreground">Tools</p>
              <nav className="flex flex-col gap-1">
                {SECONDARY_NAV_LINKS.map((link) => {
                  const active = isActiveLink(pathname, link.href);
                  return (
                    <Link
                      aria-current={active ? "page" : undefined}
                      className={active ? "footer-link-active" : "text-xs text-footer-foreground hover:underline"}
                      href={link.href}
                      key={link.href}
                    >
                      {link.label}
                    </Link>
                  );
                })}
              </nav>
            </div>
          </div>

          {/* Bottom bar */}
          <div className="flex flex-col gap-1 border-t border-border-faint py-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-[11px] text-footer-faint">
              © {new Date().getFullYear()} Kloudvestigate. All rights reserved.
            </p>
            <p className="text-[11px] text-footer-faint">
              Telemetry monitoring platform
            </p>
          </div>
        </footer>

      </div>
    </div>
  );
}

function isActiveLink(pathname: string, href: string) {
  return pathname === href || (href !== "/" && pathname.startsWith(`${href}/`));
}
