"use client";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { type ReactNode, Suspense, useState } from "react";
import { cx } from "@/components/ui/core";
import { IconActivity, IconBorrow, IconCircuit, IconConnect, IconDiscover, IconEarn, IconInfo, IconMore, IconPortfolio, IconShield, IconStrategy, IconStudio, IconTrade } from "@/components/ui/icons";
import { Sheet } from "@/components/ui/sheet";
import { AVAILABILITY_LABEL, type Availability } from "@/lib/brand";
import { connectVerified } from "@/lib/connect";
import { EXPANSION } from "@/lib/expansion";
import { Brand } from "./brand";
import { DeploymentBanner, FixtureBanner, GasBanner, NetworkPill, WrongNetworkBanner } from "./status";
import { ThemeToggle } from "./theme-toggle";
import { WalletButton } from "./wallet-button";

/**
 * Strategy-first navigation (DECISIONS D23): three groups. Personal is what a user owns and runs, Finance is the
 * instruments, Builders is where products and policies are made. An item is a link only if something real is behind
 * it in this build. "Trade" links to the read-only v2 page when the build holds the public v2 manifest, and is a
 * planned non-link otherwise. Earn and Borrow are two views of the same markets (`?view=`).
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

const PERSONAL: NavItem[] = [
  // The account policy page belongs to an account shown on Portfolio.
  { key: "portfolio", label: "Portfolio", icon: IconPortfolio, href: "/portfolio", active: (pathname) => under(pathname, "/portfolio") || under(pathname, "/sentinel") },
  { key: "strategies", label: "Strategies", icon: IconStrategy, href: "/strategies", active: (pathname) => under(pathname, "/strategies") },
  { key: "discover", label: "Discover", icon: IconDiscover, href: "/discover", active: (pathname) => under(pathname, "/discover") },
  { key: "activity", label: "Activity", icon: IconActivity, href: "/activity", active: (pathname) => under(pathname, "/activity") },
];

const FINANCE: NavItem[] = [
  { key: "earn", label: "Earn", icon: IconEarn, href: "/markets?view=earn", active: (pathname, view) => under(pathname, "/markets") && view !== "borrow" },
  { key: "borrow", label: "Borrow", icon: IconBorrow, href: "/markets?view=borrow", active: (pathname, view) => under(pathname, "/markets") && view === "borrow" },
  // v2 is deployed on testnet with a mock venue. The page is read-only, so the entry keeps an "In development" chip.
  // Without a v2 manifest in the build it stays a planned, non-link entry.
  EXPANSION.manifest.status === "ok" ? { key: "trade", label: "Trade", icon: IconTrade, href: "/trade", status: "development", active: (pathname) => under(pathname, "/trade") } : { key: "trade", label: "Trade", icon: IconTrade, status: "planned", active: () => false },
];

const BUILDERS: NavItem[] = [
  { key: "studio", label: "Studio", icon: IconStudio, href: "/studio", active: (pathname) => under(pathname, "/studio") },
  { key: "circuits", label: "Circuits", icon: IconCircuit, href: "/circuits", active: (pathname) => under(pathname, "/circuits") },
  // Shown without a status chip only while the build holds the verified testnet run (src/lib/connect.ts).
  { key: "connect", label: "Connect", icon: IconConnect, href: "/connect", ...(connectVerified() ? {} : { status: "development" as const }), active: (pathname) => under(pathname, "/connect") },
];

const ABOUT: NavItem = { key: "about", label: "About and evidence", icon: IconInfo, href: "/", active: () => false };

export const NAV_GROUPS: ReadonlyArray<{ key: string; label: string; items: NavItem[] }> = [
  { key: "personal", label: "Personal", items: PERSONAL },
  { key: "finance", label: "Finance", items: FINANCE },
  { key: "builders", label: "Builders", items: BUILDERS },
];

function StatusChip({ status }: { status: Exclude<Availability, "live"> }) {
  return <span className="ml-auto shrink-0 rounded-full border border-line px-2 py-0.5 text-[0.6875rem] leading-4 font-medium text-faint">{AVAILABILITY_LABEL[status]}</span>;
}

function RailItem({ item, active, onNavigate }: { item: NavItem; active: boolean; onNavigate?: () => void }) {
  const className = cx("flex h-10 items-center gap-3 rounded-control px-3 text-[0.9375rem] font-medium transition-colors", active ? "bg-raised text-fg" : item.href ? "text-muted hover:bg-raised hover:text-fg" : "cursor-default text-faint");
  if (!item.href) {
    return (
      <span className={className} aria-disabled="true" data-nav={item.key} data-nav-status={item.status}>
        <item.icon size={19} className="shrink-0" />
        <span className="min-w-0 truncate">{item.label}</span>
        {item.status ? <StatusChip status={item.status} /> : null}
      </span>
    );
  }
  return (
    <Link href={item.href} aria-current={active ? "page" : undefined} className={className} onClick={onNavigate} data-nav={item.key} data-nav-status={item.status ?? "live"}>
      <item.icon size={19} className="shrink-0" />
      <span className="min-w-0 truncate">{item.label}</span>
      {item.status ? <StatusChip status={item.status} /> : null}
    </Link>
  );
}

function NavGroups({ groups, view, onNavigate }: { groups: typeof NAV_GROUPS; view: string | null; onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <>
      {groups.map((group) => (
        <nav key={group.key} aria-label={group.label} className="flex flex-col gap-0.5" data-nav-group={group.key}>
          <h2 className="eyebrow px-3 pb-1.5">{group.label}</h2>
          {group.items.map((item) => (
            <RailItem key={item.key} item={item} active={item.active(pathname, view)} onNavigate={onNavigate} />
          ))}
        </nav>
      ))}
    </>
  );
}

function RailNav({ view }: { view: string | null }) {
  const pathname = usePathname();
  return (
    <div className="mt-7 flex flex-col gap-5">
      <NavGroups groups={NAV_GROUPS} view={view} />
      <div className="border-t border-line pt-3">
        <RailItem item={ABOUT} active={ABOUT.active(pathname, view)} />
      </div>
    </div>
  );
}

/** Phone tab bar: the Personal group, plus "More" for Finance, Builders and the evidence page. */
function TabBar({ view }: { view: string | null }) {
  const pathname = usePathname();
  const [more, setMore] = useState(false);
  const rest = NAV_GROUPS.filter((group) => group.key !== "personal");
  const restActive = rest.some((group) => group.items.some((item) => item.active(pathname, view)));
  return (
    <>
      <nav aria-label="Personal" className="pb-safe fixed inset-x-0 bottom-0 z-30 border-t border-line bg-bg lg:hidden" data-testid="tab-bar">
        <ul className="mx-auto grid max-w-xl grid-cols-5">
          {PERSONAL.map((item) => {
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
        <div className="flex flex-col gap-5" data-testid="more-nav">
          <NavGroups groups={rest} view={view} onNavigate={() => setMore(false)} />
          <div className="border-t border-line pt-3">
            <RailItem item={ABOUT} active={false} onNavigate={() => setMore(false)} />
          </div>
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
