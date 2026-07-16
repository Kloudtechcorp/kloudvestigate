"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { Menu } from "lucide-react";
import { LogoutButton } from "@/components/auth/LogoutButton";
import { ThemeToggleButton } from "@/components/theme/ThemeToggleButton";
import { KloudtrackEnvironmentSwitch } from "@/components/telemetry/KloudtrackEnvironmentSwitch";

export type PageNavLink = {
  href: string;
  label: string;
};

const NAV_LINKS: PageNavLink[] = [
  { href: "/", label: "Dashboard" },
  { href: "/pubmat", label: "Daily Readings" },
  { href: "/audit", label: "Audit" },
  { href: "/config", label: "Config" },
  { href: "/architecture", label: "Architecture" },
];

type PageShellProps = {
  eyebrow?: string;
  title?: string;
  description?: ReactNode;
  children: ReactNode;
  maxWidth?: "wide" | "standard" | "narrow";
};

export function PageShell({
  eyebrow,
  title,
  description,
  children,
}: PageShellProps) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <AppTopbar />
      <main className="min-h-[calc(100vh-48px)] w-full px-3 pb-6 pt-14 md:px-5">
        {title ? (
          <header className="mb-3 flex flex-col gap-1 border-b border-border pb-3">
            {eyebrow ? (
              <p className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">{eyebrow}</p>
            ) : null}
            <h1 className="text-lg font-bold leading-6 text-text-primary">{title}</h1>
            {description ? (
              <div className="max-w-3xl text-sm leading-6 text-text-secondary">{description}</div>
            ) : null}
          </header>
        ) : null}
        {children}
      </main>
    </div>
  );
}

function AppTopbar() {
  const pathname = usePathname();

  return (
    <header className="fixed inset-x-0 top-0 z-40 h-12 border-b border-border bg-background">
      <div className="flex h-full w-full items-center gap-3 px-3 md:px-5">
        <Link className="flex min-w-0 shrink-0 items-center gap-2" href="/" aria-label="Kloudvestigate dashboard">
          <span className="relative h-6 w-6 overflow-hidden rounded-[4px]">
            <Image
              src="/kloudvestigate_logo.png"
              alt=""
              fill
              sizes="24px"
              className="object-contain"
            />
          </span>
          <span className="hidden text-sm font-semibold text-text-primary sm:inline">Kloudvestigate</span>
        </Link>

        <nav className="hidden h-full items-center gap-1 md:flex" aria-label="Primary">
          {NAV_LINKS.map((link) => {
            const active = isActiveLink(pathname, link.href);
            return (
              <Link
                aria-current={active ? "page" : undefined}
                className={`flex h-full items-center border-b-2 px-3 text-sm font-medium ${
                  active
                    ? "border-accent text-text-primary"
                    : "border-transparent text-text-secondary hover:text-text-primary"
                }`}
                href={link.href}
                key={link.href}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>

        <details className="group relative md:hidden">
          <summary className="icon-button list-none" aria-label="Open navigation">
            <Menu aria-hidden="true" className="h-4 w-4" />
          </summary>
          <div className="absolute left-0 top-10 w-60 border border-border bg-bg-surface p-2 shadow-[0_1px_3px_rgba(0,0,0,0.08)]">
            {NAV_LINKS.map((link) => {
              const active = isActiveLink(pathname, link.href);
              return (
                <Link
                  aria-current={active ? "page" : undefined}
                  className={`block rounded-[4px] px-3 py-2 text-sm font-medium ${
                    active ? "bg-accent-subtle text-text-primary" : "text-text-secondary hover:bg-bg-raised"
                  }`}
                  href={link.href}
                  key={link.href}
                >
                  {link.label}
                </Link>
              );
            })}
          </div>
        </details>

        <div className="ml-auto flex items-center gap-2">
          <KloudtrackEnvironmentSwitch />
          <ThemeToggleButton />
          <LogoutButton />
        </div>
      </div>
    </header>
  );
}

function isActiveLink(pathname: string, href: string) {
  return pathname === href || (href !== "/" && pathname.startsWith(`${href}/`));
}
