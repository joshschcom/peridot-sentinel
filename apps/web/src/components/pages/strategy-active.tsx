"use client";
/**
 * Strategies that are in force on the connected wallet's accounts, read from the chain: the auto-repay trigger and
 * operator authorisations of each v1 account, and the swap grants of a v2 account. A grant carries no template
 * identity, so a row says "matches the template by shape" at most. Budgets are what the contracts report as
 * remaining; nothing is estimated, and there is no performance figure anywhere.
 */
import Link from "next/link";
import { LogCoverageText } from "@/components/domain/log-coverage";
import { ACTIVE_STATUS_LABEL, ACTIVE_STATUS_TONE, type ActiveStrategy, operatorText, useActiveStrategies } from "@/components/domain/strategy-bits";
import { Badge, ButtonLink, Card, CardHeader, ExampleTag, Mono, Skeleton } from "@/components/ui/core";
import { shortAddress } from "@/lib/format";

export function ActiveStrategies({ compact = false }: { compact?: boolean }) {
  const state = useActiveStrategies();
  return (
    <Card as="section" id="active" className="scroll-mt-28" data-testid="active-strategies" data-count={state.loading ? "" : state.strategies.length} data-v2={state.v2}>
      <CardHeader
        eyebrow="On your accounts"
        title="Active strategies"
        description={compact ? "What operators may do on your accounts right now, read from the chain." : "What operators may do on your accounts right now: each row is an authorisation the account contract holds, with the budget it still allows and when it ends."}
        action={state.strategies.some((entry) => entry.example) ? <ExampleTag /> : null}
      />
      {state.loading ? (
        <Skeleton className="m-5 h-24" />
      ) : state.unavailable ? (
        <p className="p-5 text-sm text-muted sm:p-6">{state.unavailable}</p>
      ) : state.strategies.length === 0 ? (
        <div className="p-5 sm:p-6" data-testid="active-strategies-empty">
          <p className="text-sm text-muted">{state.hasAccount ? "No operator is authorised on your accounts. Nothing can act for you." : "You have no Sentinel account yet, so there is nothing an operator could act on."}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <ButtonLink href="/strategies#create" size="sm">Create a strategy</ButtonLink>
            <ButtonLink href="/discover" size="sm" variant="secondary">Discover strategies</ButtonLink>
          </div>
        </div>
      ) : (
        <ul className="divide-y divide-line">
          {state.strategies.map((entry) => (
            <StrategyRow key={entry.id} entry={entry} compact={compact} />
          ))}
        </ul>
      )}
      {state.v1Partial ? (
        <p className="border-t border-line px-5 py-3 text-xs text-warning sm:px-6" data-testid="active-strategies-partial">
          {state.v1Partial.failed ? "The operator list of a v1 account could not be read from the chain's events just now." : "Operators of a v1 account are found from events in the blocks this app has read, which is not the account's whole history."} An authorisation granted in unread blocks would not be listed here.
          {state.v1Partial.coverage ? (
            <span className="text-faint">
              {" "}
              <LogCoverageText coverage={state.v1Partial.coverage} />
            </span>
          ) : null}
        </p>
      ) : null}
      {state.v2 === "error" ? <p className="border-t border-line px-5 py-3 text-xs text-warning sm:px-6">Your Sentinel v2 account could not be read from the public testnet RPC, so its grants are not listed. That does not mean there are none.</p> : null}
    </Card>
  );
}

function StrategyRow({ entry, compact }: { entry: ActiveStrategy; compact: boolean }) {
  return (
    <li className="p-5 text-sm sm:px-6" data-active-strategy={entry.id} data-status={entry.status} data-budget-left={entry.budgetLeftRaw.toString()}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{entry.title}</span>
          <Badge tone={ACTIVE_STATUS_TONE[entry.status]}>{ACTIVE_STATUS_LABEL[entry.status]}</Badge>
          <Badge tone="outline">{entry.accountKind}</Badge>
        </div>
        <Link href={entry.href} className="text-sm font-medium underline underline-offset-4">
          Manage or revoke
        </Link>
      </div>
      <dl className="num mt-3 grid gap-x-6 gap-y-2 sm:grid-cols-2 lg:grid-cols-4">
        <Cell label="Operator may">{entry.operations}</Cell>
        <Cell label="Budget left">
          {entry.budgetLeft}
          {entry.budgetOf ? <span className="text-muted"> of {entry.budgetOf}</span> : null}
        </Cell>
        <Cell label={entry.trigger !== null ? "Trigger" : "Where"}>{entry.trigger ?? entry.where}</Cell>
        <Cell label="Ends">{entry.expires}</Cell>
      </dl>
      {compact ? null : (
        <p className="mt-3 text-xs text-faint">
          {entry.trigger !== null ? `${entry.where}. ` : ""}
          Operator <Mono>{operatorText(entry.operator)}</Mono>
          {entry.account ? (
            <>
              {" "}
              on account <Mono>{shortAddress(entry.account)}</Mono>
            </>
          ) : null}
          . {entry.shapeNote}
        </p>
      )}
    </li>
  );
}

function Cell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[0.8125rem] text-muted">{label}</dt>
      <dd className="mt-0.5 break-words">{children}</dd>
    </div>
  );
}
