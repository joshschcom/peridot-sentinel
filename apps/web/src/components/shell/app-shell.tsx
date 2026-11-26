"use client";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { type ReactNode, Suspense, useState } from "react";
import { cx } from "@/components/ui/core";
import { IconBorrow, IconBot, IconCircuit, IconConnect, IconEarn, IconInfo, IconMore, IconShield, IconStudio, IconTrade } from "@/components/ui/icons";
import { Sheet } from "@/components/ui/sheet";
import { AVAILABILITY_LABEL, type Availability } from "@/lib/brand";
import { Brand } from "./brand";
import { DeploymentBanner, FixtureBanner, GasBanner, NetworkPill, WrongNetworkBanner } from "./status";
import { ThemeToggle } from "./theme-toggle";
import { WalletButton } from "./wallet-button";

/**
 * Navigation labels follow the Peridot Sentinel product areas (DECISIONS D11); the routes are unchanged.
 * An item is a link only if something real is behind it in this build. "Trade" has no adapter deployed, so it is
 * shown as planned and is not a link. Earn and Borrow are two views of the same markets (`?view=`).
 */
interface NavItem {
  key: string;
  label: string;
  icon: typeof IconShield;
  /** Absent for a planned area: rendered as a disabled entry, never as a link. */
  href?: string;
  status?: Exclude<Availability, "live">;
  active: (pathname: string, view: string | null, hash?: string) => boolean;
}

const under = (pathname: string, root: string) => pathname === root || pathname.startsWith(`${root}/`);

const PRIMARY: NavItem[] = [
  { key: "overview", label: "Overview", icon: IconShield, href: "/sentinel", active: (pathname) => under(pathname, "/sentinel") },
  { key: "earn", label: "Earn", icon: IconEarn, href: "/markets?view=earn", active: (pathname, view) => under(pathname, "/markets") && view !== "borrow" },
  { key: "borrow", label: "Borrow", icon: IconBorrow, href: "/markets?view=borrow", active: (pathname, view) => under(pathname, "/markets") && view === "borrow" },
  { key: "trade", label: "Trade", icon: IconTrade, status: "planned", active: () => false },
  { key: "automate", label: "Automate", icon: IconBot, href: "/automate", active: (pathname) => under(pathname, "/automate") },
  { key: "studio", label: "Studio", icon: IconStudio, href: "/studio", active: (pathname) => under(pathname, "/studio") },
];

const SECONDARY: NavItem[] = [
  { key: "circuits", label: "Circuits", icon: IconCircuit, href: "/circuits", active: (pathname) => under(pathname, "/circuits") },
  { key: "connect", label: "Connect", icon: IconConnect, href: "/automate#connect", status: "development", active: () => false },
  { key: "about", label: "About and status", icon: IconInfo, href: "/", active: () => false },
];

/** Phone tab bar: the four areas used most, plus "More" for everything else. */
const TAB_KEYS = ["overview", "earn", "borrow", "automate"];

function StatusChip({ status }: { status: Exclude<Availability, "live"> }) {
  return <span className="ml-auto shrink-0 rounded-full border border-line px-2 py-0.5 text-[0.6875rem] leading-4 font-medium text-faint">{AVAILABILITY_LABEL[status]}</span>;
}

function RailItem({ item, active, onNavigate }: { item: NavItem; active: boolean; onNavigate?: () => void }) {
  const className = cx("flex h-11 items-center gap-3 rounded-control px-3 text-[0.9375rem] font-medium transition-colors", active ? "bg-raised text-fg" : item.href ? "text-muted hover:bg-raised hover:text-fg" : "cursor-default text-faint");
  if (!item.href) {
    return (
      <span className={className} aria-disabled="true" data-nav={item.key} data-nav-status={item.status}>
        <item.icon size={19} />
        {item.label}
        {item.status ? <StatusChip status={item.status} /> : null}
      </span>
    );
  }
  return (
    <Link href={item.href} aria-current={active ? "page" : undefined} className={className} onClick={onNavigate} data-nav={item.key} data-nav-status={item.status ?? "live"}>
      <item.icon size={19} />
      {item.label}
      {item.status ? <StatusChip status={item.status} /> : null}
    </Link>
  );
}

function RailNav({ view }: { view: string | null }) {
  const pathname = usePathname();
  return (
    <>
      <nav aria-label="Primary" className="mt-8 flex flex-col gap-1">
        {PRIMARY.map((item) => (
          <RailItem key={item.key} item={item} active={item.active(pathname, view)} />
        ))}
      </nav>
      <nav aria-label="More" className="mt-6 flex flex-col gap-1 border-t border-line pt-4">
        {SECONDARY.map((item) => (
          <RailItem key={item.key} item={item} active={item.active(pathname, view)} />
        ))}
      </nav>
    </>
  );
}

function TabBar({ view }: { view: string | null }) {
  const pathname = usePathname();
  const [more, setMore] = useState(false);
  const tabs = PRIMARY.filter((item) => TAB_KEYS.includes(item.key));
  const rest = [...PRIMARY.filter((item) => !TAB_KEYS.includes(item.key)), ...SECONDARY];
  const restActive = rest.some((item) => item.active(pathname, view));
  return (
    <>
      <nav aria-label="Primary" className="pb-safe fixed inset-x-0 bottom-0 z-30 border-t border-line bg-bg lg:hidden">
        <ul className="mx-auto grid max-w-xl grid-cols-5">
          {tabs.map((item) => {
            const active = item.active(pathname, view);
            return (
              <li key={item.key}>
                <Link href={item.href!} aria-current={active ? "page" : undefined} className={cx("flex h-16 flex-col items-center justify-center gap-1 text-[0.6875rem] font-medium", active ? "text-fg" : "text-faint")} data-nav={item.key}>
                  <item.icon size={22} strokeWidth={active ? 2 : 1.6} />
                  {item.label}
                </Link>
              </li>
            );
          })}
          <li>
            <button type="button" onClick={() => setMore(true)} aria-haspopup="dialog" className={cx("flex h-16 w-full flex-col items-center justify-center gap-1 text-[0.6875rem] font-medium", restActive ? "text-fg" : "text-faint")} data-nav="more">
              <IconMore size={22} strokeWidth={restActive ? 2 : 1.6} />
              More
            </button>
          </li>
        </ul>
      </nav>
      <Sheet open={more} onClose={() => setMore(false)} title="More">
        <div className="flex flex-col gap-1" data-testid="more-nav">
          {rest.map((item) => (
            <RailItem key={item.key} item={item} active={item.active(pathname, view)} onNavigate={() => setMore(false)} />
          ))}
        </div>
      </Sheet>
    </>
  );
}

/** `?view=` decides between Earn and Borrow. Read through Suspense so statically rendered pages keep prerendering. */
function WithView({ children }: { children: (view: string | null) => ReactNode }) {
  const params = useSearchParams();
  return <>{children(params.get("view"))}</>;
}
const viewAware = (render: (view: string | null) => ReactNode) => (
  <Suspense fallback={render(null)}>
    <WithView>{render}</WithView>
  </Suspense>
);

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-dvh">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-full focus:bg-inverse focus:px-4 focus:py-2 focus:text-sm focus:text-on-inverse">
        Skip to content
      </a>
      <div className="sticky top-0 z-30">
        <FixtureBanner />
        <DeploymentBanner />
        <WrongNetworkBanner />
        <GasBanner />
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
          <div className="sticky top-10 flex h-[calc(100dvh-2.5rem)] flex-col overflow-y-auto px-3 py-5">
            <div className="px-3">
              <Brand />
            </div>
            {viewAware((view) => (
              <RailNav view={view} />
            ))}
            <div className="mt-auto space-y-2 px-3 pt-6 text-xs text-faint">
              <p>Experimental test profile. Test tokens have no value. Not audited.</p>
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

      {viewAware((view) => (
        <TabBar view={view} />
      ))}
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
