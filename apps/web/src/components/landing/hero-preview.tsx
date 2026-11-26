import { ExampleTag } from "@/components/ui/core";
import { IconBot, IconCheck, IconShield, IconX } from "@/components/ui/icons";

/**
 * Hero illustration: a portfolio with one strategy on it, the budget that strategy still has, and one action the
 * account refused. A static drawing. Every figure is an example and the whole panel is labelled as an illustration;
 * no number here is read from a chain, a market or a user.
 */
export function HeroPreview() {
  return (
    <figure className="relative mx-auto w-full max-w-md lg:max-w-none" aria-label="Illustration with example numbers: a portfolio, one strategy with its remaining budget, and one refused action" data-testid="hero-preview">
      <div className="mb-3 flex items-center justify-between gap-3 text-xs text-muted">
        <span data-testid="hero-preview-label">Illustration · example numbers, not live data</span>
        <ExampleTag label="Illustrative" />
      </div>
      <div className="rounded-3xl border border-line bg-surface p-5 sm:p-6">
        <div className="eyebrow">Portfolio</div>
        <div className="num mt-1.5 text-3xl font-semibold tracking-tight">
          1,840 <span className="text-muted">test USD</span>
        </div>
        <dl className="num mt-4 grid grid-cols-3 gap-3 text-sm">
          <Figure label="Collateral" value="2,000" />
          <Figure label="Debt" value="640" />
          <Figure label="Idle" value="480" />
        </dl>

        <div className="mt-5 rounded-2xl border border-line p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <span className="grid size-9 shrink-0 place-items-center rounded-full bg-raised text-fg">
                <IconShield size={18} />
              </span>
              <div>
                <div className="text-sm font-medium">Debt protection</div>
                <div className="text-[0.8125rem] text-muted">Repay when loan-to-value reaches 50%</div>
              </div>
            </div>
            <span className="inline-flex h-6 items-center rounded-full bg-success-soft px-2.5 text-xs font-medium text-success">Active</span>
          </div>
          <div className="mt-4">
            <div className="num flex items-baseline justify-between text-[0.8125rem] text-muted">
              <span>Budget left</span>
              <span>
                <span className="text-fg">150</span> of 200
              </span>
            </div>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-raised" aria-hidden="true">
              <div className="h-full w-3/4 rounded-full bg-fg" />
            </div>
            <div className="num mt-2 flex items-baseline justify-between text-[0.8125rem] text-muted">
              <span>Ends in 6 days</span>
              <span>Operator may: repay only</span>
            </div>
          </div>
        </div>
      </div>

      <ul className="mt-3 space-y-2 sm:ml-10">
        <Event ok icon={<IconBot size={17} />} title="Operator repaid 50" detail="Inside the grant · budget 200 → 150" />
        <Event icon={<IconBot size={17} />} title="Operator tried to borrow" detail="Refused by the account · no grant for it" />
      </ul>
      <figcaption className="sr-only">Illustration with example numbers. Not live data.</figcaption>
    </figure>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-subtle px-3 py-2.5">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-0.5 font-medium">{value}</dd>
    </div>
  );
}

function Event({ ok = false, icon, title, detail }: { ok?: boolean; icon: React.ReactNode; title: string; detail: string }) {
  return (
    <li className="flex items-center gap-3 rounded-2xl border border-line bg-surface p-3.5">
      <span className="grid size-9 shrink-0 place-items-center rounded-full bg-raised text-fg">{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{title}</div>
        <div className="num truncate text-[0.8125rem] text-muted">{detail}</div>
      </div>
      <span className={`grid size-6 shrink-0 place-items-center rounded-full ${ok ? "bg-success-soft text-success" : "bg-warning-soft text-warning"}`}>{ok ? <IconCheck size={14} strokeWidth={2.4} /> : <IconX size={14} strokeWidth={2.4} />}</span>
    </li>
  );
}
