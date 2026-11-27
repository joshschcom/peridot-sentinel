/**
 * The six things every public surface states, always in the same words and order (DECISIONS D24): where this runs,
 * what the tokens are, what is a mock, which processor evaluates the circuits, that nothing was audited, and who
 * can withdraw. One short line that is always visible, with one sentence each behind "What this means".
 * No "use client": the server-rendered landing page uses it too.
 */
import { TARGET_KIND } from "@/lib/chains";

const LOCAL = TARGET_KIND === "local";

export const DISCLOSURES = [
  {
    key: "network",
    short: LOCAL ? "Local development chain" : "X Layer testnet",
    long: LOCAL ? "This build talks to a local development chain. Nothing here is a public or mainnet deployment." : "Everything here runs on X Layer testnet (chain 1952). Nothing here is a mainnet deployment, and no mainnet contract holds funds.",
  },
  { key: "test-tokens", short: "Test tokens, no value", long: "Every token is a test token without value. Nothing on this site is an offer, a yield promise or financial advice." },
  { key: "mocks", short: "Mock price feeds and venues", long: "Prices come from a mock feed, swaps go through a mock venue and the vault is a mock. No real exchange or yield source is connected." },
  { key: "processor", short: "Development reference processor", long: "Policy circuits are evaluated by a development reference processor on this network, not by TapeOut." },
  { key: "audit", short: "Not audited", long: "The software is experimental. The checks this app runs in your browser confirm that it reads the expected contracts; they are not an audit, and none has been performed." },
  { key: "withdrawal", short: "Only the owner can withdraw", long: "Owner-only withdrawal: an operator or an AI can act inside the limits you sign, and can never move funds out of your account." },
] as const;

export function Disclosures({ className = "" }: { className?: string }) {
  return (
    <details className={`group rounded-control border border-line bg-subtle text-[0.8125rem] text-muted ${className}`} data-testid="disclosures">
      <summary className="flex min-h-11 flex-wrap items-center gap-x-1.5 gap-y-1 px-3.5 py-2.5">
        {DISCLOSURES.map((item, index) => (
          <span key={item.key} data-disclosure={item.key}>
            {item.short}
            {index < DISCLOSURES.length - 1 ? <span aria-hidden="true"> ·</span> : null}
          </span>
        ))}
        <span className="ml-auto font-medium text-fg underline underline-offset-4 group-open:hidden">What this means</span>
        <span className="ml-auto hidden font-medium text-fg underline underline-offset-4 group-open:inline">Hide</span>
      </summary>
      <dl className="space-y-2.5 border-t border-line px-3.5 py-3" data-testid="disclosure-details">
        {DISCLOSURES.map((item) => (
          <div key={item.key}>
            <dt className="font-medium text-fg">{item.short}</dt>
            <dd className="mt-0.5">{item.long}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}
