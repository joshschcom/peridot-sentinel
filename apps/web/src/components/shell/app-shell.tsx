"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { cx } from "@/components/ui/core";
import { IconCircuit, IconMarkets, IconShield, IconStudio } from "@/components/ui/icons";
import { Brand } from "./brand";
import { FixtureBanner, NetworkPill, WrongNetworkBanner } from "./status";
import { ThemeToggle } from "./theme-toggle";
import { WalletButton } from "./wallet-button";

const NAV = [
  { href: "/sentinel", label: "Sentinel", hint: "Your account", icon: IconShield },
  { href: "/markets", label: "Markets", hint: "Lend and borrow", icon: IconMarkets },
  { href: "/studio", label: "Studio", hint: "Build a market", icon: IconStudio },
  { href: "/circuits", label: "Circuits", hint: "Policy evidence", icon: IconCircuit },
] as const;

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return (
    <div className="min-h-dvh">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-full focus:bg-inverse focus:px-4 focus:py-2 focus:text-sm focus:text-on-inverse">
        Skip to content
      </a>
      <div className="sticky top-0 z-30">
        <FixtureBanner />
        <WrongNetworkBanner />
        <header className="border-b border-line bg-bg lg:hidden">
          <div className="flex h-14 items-center justify-between gap-2 px-4 sm:px-6">
            <Brand compact />
            <div className="flex items-center gap-1.5">
              <NetworkPill />
              <ThemeToggle />
              <WalletButton />
            </div>
          </div>
        </header>
      </div>

      <div className="mx-auto flex max-w-[100rem]">
        {/* Desktop side rail */}
        <aside className="hidden w-60 shrink-0 border-r border-line lg:block">
          <div className="sticky top-10 flex h-[calc(100dvh-2.5rem)] flex-col px-3 py-5">
          <div className="px-3">
            <Brand />
          </div>
          <nav aria-label="Primary" className="mt-8 flex flex-col gap-1">
            {NAV.map((item) => {
              const active = isActive(pathname, item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={cx("flex h-11 items-center gap-3 rounded-control px-3 text-[0.9375rem] font-medium transition-colors", active ? "bg-raised text-fg" : "text-muted hover:bg-raised hover:text-fg")}
                >
                  <item.icon size={19} />
                  {item.label}
                </Link>
              );
            })}
          </nav>
          <div className="mt-auto space-y-3 px-3 text-xs text-faint">
            <p>Experimental test profile. Test tokens have no value. Not audited.</p>
            <Link href="/" className="inline-block font-medium text-muted underline-offset-4 hover:text-fg hover:underline">
              About Peridot
            </Link>
          </div>
          </div>
        </aside>

        <div className="min-w-0 flex-1">
          <div className="hidden h-16 items-center justify-end gap-2 border-b border-line px-8 lg:flex">
            <NetworkPill />
            <ThemeToggle />
            <WalletButton />
          </div>
          <main id="main" className="mx-auto w-full max-w-6xl px-4 pt-6 pb-28 sm:px-6 sm:pt-8 lg:px-8 lg:pb-16">
            {children}
          </main>
        </div>
      </div>

      {/* Mobile tab bar */}
      <nav aria-label="Primary" className="pb-safe fixed inset-x-0 bottom-0 z-30 border-t border-line bg-bg lg:hidden">
        <ul className="mx-auto grid max-w-xl grid-cols-4">
          {NAV.map((item) => {
            const active = isActive(pathname, item.href);
            return (
              <li key={item.href}>
                <Link href={item.href} aria-current={active ? "page" : undefined} className={cx("flex h-16 flex-col items-center justify-center gap-1 text-[0.6875rem] font-medium", active ? "text-fg" : "text-faint")}>
                  <item.icon size={22} strokeWidth={active ? 2 : 1.6} />
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}

export function SubNav({ items }: { items: ReadonlyArray<{ href: string; label: string }> }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Section" className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <ul className="flex gap-1 border-b border-line">
        {items.map((item) => {
          const active = pathname === item.href;
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cx("-mb-px flex h-11 items-center border-b-2 px-3 text-[0.9375rem] font-medium whitespace-nowrap", active ? "border-fg text-fg" : "border-transparent text-muted hover:text-fg")}
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
