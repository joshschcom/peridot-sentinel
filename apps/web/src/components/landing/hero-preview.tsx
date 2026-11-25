import { ExampleTag } from "@/components/ui/core";
import { IconBot, IconCheck, IconMarkets, IconShield, IconX } from "@/components/ui/icons";

/**
 * Original product preview for the hero: one transaction passing through three independent checks.
 * Static illustration. Every figure is an example and is labelled as such.
 */
export function HeroPreview() {
  return (
    <figure className="relative mx-auto w-full max-w-md lg:max-w-none" aria-label="Example: a borrow request checked by three independent layers">
      <div className="rounded-3xl border border-line bg-surface p-5 sm:p-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="eyebrow">Borrow request</div>
            <div className="num mt-1.5 text-3xl font-semibold tracking-tight">
              1,400 <span className="text-muted">tUSDC</span>
            </div>
          </div>
          <ExampleTag />
        </div>

        <ol className="mt-6 space-y-2.5">
          <Check
            icon={<IconShield size={18} />}
            title="Your Sentinel policy"
            rule="Max loan-to-value 55%"
            result="58%"
            status="deny"
          />
          <Check icon={<span className="text-xs font-semibold">P</span>} title="Protocol safety limits" rule="Borrowing limit 70%" result="58%" status="pass" />
          <Check icon={<IconMarkets size={18} />} title="Market policy" rule="Max loan-to-value 65%" result="58%" status="pass" />
        </ol>

        <div className="mt-5 flex items-center gap-3 rounded-2xl border border-warning bg-warning-soft p-3.5">
          <span className="grid size-8 shrink-0 place-items-center rounded-full bg-warning text-bg">
            <IconShield size={16} />
          </span>
          <p className="text-sm">
            <span className="font-medium">Stopped by your own rule.</span> <span className="text-muted">The market would have allowed it.</span>
          </p>
        </div>
      </div>

      <div className="mt-3 flex items-center gap-3 rounded-2xl border border-line bg-surface p-4 sm:ml-10">
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-raised text-fg">
          <IconBot size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-sm font-medium">
            Auto-repay <ExampleTag />
          </div>
          <div className="num text-[0.8125rem] text-muted">150 tUSDC from idle funds · loan-to-value 51.2% → 46.6%</div>
        </div>
        <span className="grid size-6 shrink-0 place-items-center rounded-full bg-success-soft text-success">
          <IconCheck size={14} strokeWidth={2.4} />
        </span>
      </div>
      <figcaption className="sr-only">Illustration with example numbers. Not live data.</figcaption>
    </figure>
  );
}

function Check({ icon, title, rule, result, status }: { icon: React.ReactNode; title: string; rule: string; result: string; status: "pass" | "deny" }) {
  return (
    <li className="flex items-center gap-3 rounded-2xl border border-line p-3.5">
      <span className="grid size-9 shrink-0 place-items-center rounded-full bg-raised text-fg">{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{title}</div>
        <div className="num truncate text-[0.8125rem] text-muted">{rule}</div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <span className="num text-sm text-muted">{result}</span>
        {status === "pass" ? (
          <span className="inline-flex h-6 items-center gap-1 rounded-full bg-success-soft px-2 text-xs font-medium text-success">
            <IconCheck size={12} strokeWidth={2.6} /> Pass
          </span>
        ) : (
          <span className="inline-flex h-6 items-center gap-1 rounded-full bg-warning-soft px-2 text-xs font-medium text-warning">
            <IconX size={12} strokeWidth={2.6} /> Deny
          </span>
        )}
      </div>
    </li>
  );
}
