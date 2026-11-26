"use client";
/**
 * Automate: how software may act for a Sentinel account.
 *
 * Three modes, each labelled with what this build can actually do (DECISIONS D12, D13, D15):
 *   rule-based            LIVE. The auto-repay trigger and a repay-only operator, enforced by the account contract.
 *   bring your own agent  Sentinel Connect (MCP). Shown as "In development" until the MCP flow is verified on testnet.
 *   Peridot-hosted AI     PLANNED. No hosted model runs anywhere in this build.
 *
 * The strategy form only has live inputs for fields the v1 account contract stores: permission mask, cumulative
 * budget, expiry and the trigger. Everything else is listed as planned and has no input that could be mistaken
 * for a setting.
 */
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { isAddress } from "viem";
import { LogCoverageText, coverageRanges } from "@/components/domain/log-coverage";
import { marketTitle, tokenAmount } from "@/components/domain/market-bits";
import { SourceTag } from "@/components/domain/policy-card";
import { TxFeedback } from "@/components/domain/tx-feedback";
import { Badge, Button, ButtonLink, Card, CardHeader, EmptyState, ExampleTag, Mono, PageHeader, Skeleton, type Tone } from "@/components/ui/core";
import { IconAlert, IconBot, IconConnect, IconLock, IconShield } from "@/components/ui/icons";
import { useChainTx } from "@/hooks/use-chain-tx";
import { useAccounts, useMarket, useMarkets } from "@/hooks/use-data";
import { useWriteGate } from "@/hooks/use-wallet";
import { formatAmount, formatBps } from "@/lib/amount";
import { AVAILABILITY_LABEL, type Availability } from "@/lib/brand";
import { WRITE_CHAIN_ID, explorerTxUrl } from "@/lib/chains";
import { CONNECT, CONNECT_STATUS_LABEL, connectVerified } from "@/lib/connect";
import { formatDay, shortAddress, shortHash } from "@/lib/format";
import { Op } from "@/lib/policy";
import { services } from "@/services";
import { emergencyStopPlan } from "@/services/chain/plans";
import { readAutoRepays, readStopState } from "@/services/chain/reads";
import type { Address, Market, SentinelAccount } from "@/services/types";
import { Automation } from "./automation";
import { KeeperPanel } from "./keeper-panel";

/**
 * Availability of each mode in THIS build. "live" for rule-based holds only while accounts are read from the chain.
 * Sentinel Connect is "live" (shown as "Available on testnet (agent-directed)") only while the build contains the
 * recorded public testnet run and a tool catalogue with exactly one executing tool (src/lib/connect.ts).
 */
const CONNECT_AVAILABILITY: Availability = connectVerified() ? "live" : "development";
const HOSTED_AVAILABILITY: Availability = "planned";
const TONE: Record<Availability, Tone> = { live: "success", development: "warning", planned: "outline" };

function AvailabilityBadge({ status, label }: { status: Availability; label?: string }) {
  return (
    <Badge tone={TONE[status]} wrap={Boolean(label)}>
      {label ?? AVAILABILITY_LABEL[status]}
    </Badge>
  );
}

export function Automate() {
  const accounts = useAccounts();
  const markets = useMarkets();
  const chain = services.account.source === "chain";
  const list = accounts.data?.status === "ok" ? accounts.data.value : [];
  // One account per market. `?market=<id>` selects it; read after mount so the page can still be prerendered.
  const [selected, setSelected] = useState<string | null>(null);
  useEffect(() => {
    setSelected(new URLSearchParams(window.location.search).get("market"));
  }, []);
  const account = list.find((entry) => selected !== null && entry.marketId.toLowerCase() === selected.toLowerCase()) ?? list[0] ?? null;
  const choose = (marketId: string) => {
    setSelected(marketId);
    window.history.replaceState(null, "", `?market=${marketId}${window.location.hash}`);
  };
  const label = (entry: SentinelAccount) => {
    const market = markets.data?.status === "ok" ? markets.data.value.find((m) => m.id === entry.marketId) : undefined;
    return market ? `${marketTitle(market)}, market #${market.index}` : entry.marketId;
  };
  const ruleBased: Availability = chain ? "live" : "development";

  return (
    <div className="space-y-6" data-testid="automate">
      <PageHeader
        eyebrow="Sentinel"
        title="Automate"
        description="Let software act for your Sentinel account, inside limits the account contract enforces: which operations, how much in total, and until when. You stay the owner, and you can stop everything at once."
        actions={<SourceTag source={services.account.source} />}
      />

      <ul className="grid gap-3 lg:grid-cols-3" data-testid="automation-modes">
        <Mode
          id="rule-based"
          icon={<IconShield size={18} />}
          name="Rule-based"
          status={ruleBased}
          statusNote={chain ? null : "Example data in this build"}
          body="You set a loan-to-value trigger. An operator you authorise may then repay debt from the account's own idle funds, up to a budget and until an expiry."
          href="#rules"
          cta="Set rules"
        />
        <Mode
          id="connect"
          icon={<IconConnect size={18} />}
          name="Bring your own agent"
          sub="Sentinel Connect"
          status={CONNECT_AVAILABILITY}
          statusLabel={CONNECT_AVAILABILITY === "live" ? CONNECT_STATUS_LABEL : undefined}
          body="Your own agent reads the account, simulates, and executes one restricted operation through the same operator authorisation, over MCP. It never holds your key."
          href={CONNECT_AVAILABILITY === "live" ? "/connect" : "#connect"}
          cta={CONNECT_AVAILABILITY === "live" ? "Tools, setup and the recorded run" : "What is being built"}
        />
        <Mode id="hosted" icon={<IconBot size={18} />} name="Peridot-hosted AI" status={HOSTED_AVAILABILITY} body="An agent run by Peridot that proposes actions for your account. Not built: no hosted model runs in this app, and nothing here calls one." />
      </ul>

      {accounts.isPending ? (
        <Skeleton className="h-96" data-loading />
      ) : account ? (
        <>
          {list.length > 1 ? (
            <label className="block text-sm">
              <span className="font-medium">Account</span>
              <select id="account-select" value={account.marketId} onChange={(event) => choose(event.target.value)} className="mt-2 h-11 w-full max-w-xl rounded-control border border-line-strong bg-bg px-3">
                {list.map((entry) => (
                  <option key={entry.marketId} value={entry.marketId}>
                    {label(entry)}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <AccountAutomation key={account.marketId} account={account} />
        </>
      ) : accounts.data?.status === "unavailable" ? (
        <EmptyState title="Account data unavailable">{accounts.data.reason}</EmptyState>
      ) : (
        <EmptyState title="No Sentinel account yet" action={<ButtonLink href="/sentinel">Create an account</ButtonLink>}>
          Automation is set per Sentinel account. Create one from the overview first.
        </EmptyState>
      )}

      <ConnectSection />

      <Card as="section" id="hosted" className="scroll-mt-28" data-mode="hosted" data-availability={HOSTED_AVAILABILITY}>
        <CardHeader eyebrow="Mode 3" title="Peridot-hosted AI" description="An agent operated by Peridot that proposes actions within your policy." action={<AvailabilityBadge status={HOSTED_AVAILABILITY} />} />
        <p className="p-5 text-sm text-muted sm:p-6">
          This mode does not exist yet. There is no hosted model, no chat and no recommendation in this app, and no setting on this page enables one. When it is built it will use the same operator authorisation as the other modes, so the limits and the emergency stop on this page will apply to it unchanged.
        </p>
      </Card>

      <section id="agent-activity" className="scroll-mt-28 space-y-3">
        <h2 className="text-lg font-semibold tracking-tight">Agent activity</h2>
        <p className="max-w-2xl text-sm text-muted">What the chain confirms for this account. When an automation service is connected to this deployment, its reports (checked, simulated, submitted) are listed separately, and a report alone is never shown as confirmed.</p>
        {account ? <AccountRepays account={account} market={markets.data?.status === "ok" ? (markets.data.value.find((entry) => entry.id === account.marketId) ?? null) : null} /> : null}
        <KeeperPanel />
        <ButtonLink href="/sentinel/activity" variant="secondary" size="sm">
          All account activity
        </ButtonLink>
      </section>
    </div>
  );
}

function Mode({ id, icon, name, sub, status, statusLabel, statusNote, body, href, cta }: { id: string; icon: React.ReactNode; name: string; sub?: string; status: Availability; statusLabel?: string; statusNote?: string | null; body: string; href?: string; cta?: string }) {
  return (
    <Card as="li" className="flex flex-col p-5" data-mode={id} data-availability={status}>
      <div className="flex items-start justify-between gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-raised">{icon}</span>
        <AvailabilityBadge status={status} label={statusLabel} />
      </div>
      <h2 className="mt-4 text-base font-semibold tracking-tight">{name}</h2>
      {sub ? <p className="text-xs font-medium text-faint">{sub}</p> : null}
      <p className="mt-2 flex-1 text-sm text-muted">{body}</p>
      {statusNote ? <p className="mt-2 text-xs text-warning">{statusNote}</p> : null}
      {href && cta ? (
        <a href={href} className="mt-4 text-sm font-medium underline underline-offset-4">
          {cta}
        </a>
      ) : null}
    </Card>
  );
}

function AccountAutomation({ account }: { account: SentinelAccount }) {
  const market = useMarket(account.marketId);
  const m = market.data?.status === "ok" ? market.data.value : null;
  const chain = services.account.source === "chain";
  return (
    <>
      <EmergencyStop account={account} />
      <Card as="section" id="rules" className="scroll-mt-28" data-mode="rule-based">
        <CardHeader
          eyebrow="Mode 1 · Rule-based"
          title="Strategy"
          description="A strategy is the set of limits an operator works inside. Fields marked Live are stored and enforced by your account contract. Fields marked Planned have no effect and cannot be set."
          action={chain ? <AvailabilityBadge status="live" /> : <ExampleTag />}
        />
        {m ? <StrategyOutline account={account} market={m} /> : <Skeleton className="m-5 h-40" />}
        <div className="border-t border-line">{m ? <Automation account={account} market={m} /> : <Skeleton className="m-5 h-40" />}</div>
      </Card>
    </>
  );
}

/**
 * The six strategy fields, each mapped to what enforces it today. Read-only: the live inputs are in the panel below
 * (one input per on-chain field), and planned fields deliberately have no input at all.
 */
function StrategyOutline({ account, market }: { account: SentinelAccount; market: Market }) {
  const grants = account.operators.filter((entry) => !entry.revoked);
  const debt = market.debt.token;
  const ops = (mask: number) => [(mask & (1 << Op.REPAY)) !== 0 ? "repay" : null, (mask & (1 << Op.BORROW)) !== 0 ? "borrow into the account" : null].filter(Boolean).join(" and ") || "nothing";
  const cap = account.policy.identified ? formatBps(account.policy.spec.params.maxLtvBps) : null;
  const rows: Array<{ field: string; status: Availability; now: React.ReactNode; enforced: string; planned?: string }> = [
    {
      field: "Objective",
      status: "live",
      now: account.autoRepayTriggerBps > 0 ? `Repay debt from idle funds when loan-to-value reaches ${formatBps(account.autoRepayTriggerBps)}` : "None set: auto-repay is disabled",
      enforced: "autoRepayTriggerBps on the account. autoRepay() reverts with TriggerNotMet below it.",
      planned: "Other objectives (earning on idle funds, rebalancing, swaps) need adapters that are not deployed.",
    },
    {
      field: "Capital budget",
      status: "live",
      now: grants.length ? grants.map((entry) => `${tokenAmount(entry.remaining, debt)} left`).join(", ") : "No operator authorised",
      enforced: "Cumulative budget of the operator authorisation. It only goes down, and a new authorisation replaces it.",
    },
    {
      field: "Permitted operations",
      status: "live",
      now: grants.length ? grants.map((entry) => ops(entry.opsMask)).join(", ") : "None",
      enforced: "Permission mask of the authorisation (repay = 8, borrow = 4). There is no mask bit for withdrawing.",
    },
    {
      field: "Approved protocols",
      status: "planned",
      now: `Fixed: this account's Peridot lending market (${marketTitle(market)})`,
      enforced: "A v1 account is bound to one market controller, so there is nothing to choose.",
      planned: "Choosing among protocols arrives with the adapter-based account (v2), which is not deployed.",
    },
    {
      field: "Risk limits",
      status: "live",
      now: (
        <>
          Trigger {account.autoRepayTriggerBps > 0 ? formatBps(account.autoRepayTriggerBps) : "disabled"}
          {cap ? `, your policy cap ${cap}` : ""}
        </>
      ),
      enforced: "The trigger, plus your account policy circuit and the market policy circuit on every risk-increasing action.",
      planned: "Slippage and per-transaction limits belong to swap and vault adapters, which are not deployed.",
    },
    {
      field: "Expiry",
      status: "live",
      now: grants.length ? grants.map((entry) => `${entry.expired ? "expired " : ""}${formatDay(entry.expiresAt)}`).join(", ") : "No operator authorised",
      enforced: "Expiry timestamp of the authorisation, compared with the block time.",
    },
  ];
  return (
    <dl className="divide-y divide-line" data-testid="strategy-outline">
      {rows.map((row) => (
        <div key={row.field} className="grid gap-x-6 gap-y-1 px-5 py-3.5 sm:grid-cols-[11rem_1fr] sm:px-6" data-field={row.field} data-availability={row.status}>
          <dt className="flex items-center gap-2 text-sm font-medium sm:items-start sm:pt-0.5">
            <span className="min-w-0 flex-1">{row.field}</span>
            <AvailabilityBadge status={row.status} />
          </dt>
          <dd className="min-w-0 text-sm">
            <p className="num">{row.now}</p>
            <p className="mt-0.5 text-[0.8125rem] text-muted">{row.enforced}</p>
            {row.planned ? <p className="mt-0.5 text-[0.8125rem] text-faint">Planned: {row.planned}</p> : null}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * One control that ends automation on the account: the operators this page knows about are revoked, then the
 * trigger is cleared. Operators are found from events in the block ranges that were read, so when that scan has a
 * gap the copy says "found", never "every", and the owner can add an address by hand. After the transactions are
 * mined the chain is read again (with retries) and only that read is reported as the outcome.
 */
function EmergencyStop({ account }: { account: SentinelAccount }) {
  const gate = useWriteGate("account");
  const chain = services.account.source === "chain";
  const tx = useChainTx();
  const [extra, setExtra] = useState("");
  const [confirmed, setConfirmed] = useState<{ stillAuthorised: Address[]; triggerBps: number } | { error: string } | null>(null);
  const address = account.address.status === "ok" ? account.address.value : null;
  const listed = account.operators.flatMap((entry) => (!entry.revoked && entry.operator.status === "ok" ? [entry.operator.value as Address] : []));
  const extraValid = isAddress(extra);
  const operators = extraValid && !listed.some((operator) => operator.toLowerCase() === extra.toLowerCase()) ? [...listed, extra as Address] : listed;
  const discovery = account.operatorDiscovery;
  const partial = chain && discovery !== undefined && (!discovery.complete || discovery.failed);
  const triggerOn = account.autoRepayTriggerBps > 0;
  const count = operators.length + (triggerOn ? 1 : 0);
  const busy = tx.state.phase === "running";
  const stop = async () => {
    if (!address || count === 0) return;
    setConfirmed(null);
    const targets = operators;
    const run = await tx.run(emergencyStopPlan(address, targets, triggerOn), "Emergency stop transactions mined. Reading the account again to confirm…");
    if (!run.ok) return;
    try {
      setConfirmed(await readStopState(address, targets));
    } catch (error) {
      setConfirmed({ error: error instanceof Error ? error.message.split("\n")[0]! : "The account could not be read again" });
    }
  };
  return (
    <Card as="section" className="border-danger" data-testid="emergency-stop" data-operators={listed.length} data-trigger={account.autoRepayTriggerBps} data-discovery={partial ? "partial" : "complete"}>
      <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
        <div className="flex min-w-0 gap-3.5">
          <span className="grid size-9 shrink-0 place-items-center rounded-full bg-danger-soft text-danger">
            <IconAlert size={18} />
          </span>
          <div className="min-w-0">
            <h2 className="text-base font-semibold tracking-tight">Emergency stop</h2>
            <p className="mt-1 max-w-xl text-sm text-muted">
              Revokes {partial ? "the operators this page found on" : "every operator on"} this account, then clears the auto-repay trigger. An operator can no longer act from the moment its revocation is mined. Your position and funds are not touched, and withdrawing was always yours alone.
            </p>
            <p className="mt-2 text-[0.8125rem]" data-testid="emergency-stop-scope">
              {count === 0 ? (
                <span className="text-muted">{partial ? "Nothing found to stop: no operator was found in the blocks that were read, and the trigger is disabled." : "Nothing to stop: no operator is authorised and the trigger is disabled."}</span>
              ) : (
                <span>
                  Now active: {operators.length === 0 ? "no operator found" : operators.map((operator) => shortAddress(operator)).join(", ")}
                  {triggerOn ? `, trigger at ${formatBps(account.autoRepayTriggerBps)}` : ", trigger disabled"}. This sends {count} transaction{count === 1 ? "" : "s"}, one at a time.
                </span>
              )}
            </p>
          </div>
        </div>
        <Button variant="danger" size="lg" className="shrink-0" disabled={!chain || !gate.allowed || !address || count === 0 || busy} onClick={() => void stop()} data-testid="emergency-stop-submit">
          {!gate.allowed ? <IconLock size={16} /> : null} Stop all automation
        </Button>
      </div>
      {partial ? (
        <div className="space-y-2 border-t border-line px-5 py-4 text-[0.8125rem] sm:px-6" data-testid="emergency-stop-partial">
          <p className="text-warning">
            {discovery?.failed ? "The operator list could not be read from the chain's events just now." : "The operator list comes from events in the blocks this app has read, which is not the account's whole history."} An operator authorised in unread blocks would not be listed above.
            {discovery?.coverage ? <span className="text-muted"> Read so far: {coverageRanges(discovery.coverage)}.</span> : null}
          </p>
          <label className="block">
            <span className="text-muted">Also revoke this address (optional)</span>
            <input id="emergency-extra" type="text" spellCheck={false} autoComplete="off" value={extra} onChange={(event) => setExtra(event.target.value.trim())} placeholder="0x…" className="mt-1.5 h-10 w-full max-w-xl min-w-0 rounded-control border border-line-strong bg-bg px-3 font-mono text-[0.8125rem] outline-none focus:border-fg" />
          </label>
          {extra !== "" && !extraValid ? <p className="text-danger">This is not a valid address.</p> : null}
        </div>
      ) : null}
      {!gate.allowed ? <p className="border-t border-line px-5 py-3 text-[0.8125rem] text-muted sm:px-6">{gate.message}</p> : null}
      {tx.state.phase !== "idle" ? (
        <div className="space-y-3 border-t border-line p-5 sm:p-6">
          <TxFeedback state={tx.state} chainId={WRITE_CHAIN_ID} marketId={account.marketId} />
          {confirmed === null ? null : "error" in confirmed ? (
            <p className="text-sm text-warning" data-testid="emergency-stop-confirmed" data-confirmed="unknown">
              The transactions were mined, but the account could not be read again to confirm the result: {confirmed.error}. Check the list above after refreshing.
            </p>
          ) : confirmed.stillAuthorised.length === 0 && confirmed.triggerBps === 0 ? (
            <p className="text-sm text-success" data-testid="emergency-stop-confirmed" data-confirmed="true">
              Confirmed by a fresh read of the account: {partial ? "the revoked operators have no authorisation" : "no listed operator has an authorisation"} and the auto-repay trigger is 0.
            </p>
          ) : (
            <p className="text-sm text-danger" data-testid="emergency-stop-confirmed" data-confirmed="false">
              Not confirmed yet. The latest read still shows {confirmed.stillAuthorised.length ? `an authorisation for ${confirmed.stillAuthorised.map((operator) => shortAddress(operator)).join(", ")}` : ""}
              {confirmed.stillAuthorised.length && confirmed.triggerBps ? " and " : ""}
              {confirmed.triggerBps ? `a trigger of ${formatBps(confirmed.triggerBps)}` : ""}. The network's RPC can lag behind a mined transaction: refresh in a moment before relying on this.
            </p>
          )}
        </div>
      ) : null}
    </Card>
  );
}

/** AutoRepayExecuted events emitted by THIS account, read from the chain. Independent of any keeper service. */
function AccountRepays({ account, market }: { account: SentinelAccount; market: Market | null }) {
  const address = account.address.status === "ok" ? account.address.value : null;
  const repays = useQuery({ queryKey: ["account-auto-repays", WRITE_CHAIN_ID, address], queryFn: () => readAutoRepays(address as Address), enabled: address !== null && services.activity.source === "chain", staleTime: 30_000 });
  if (services.activity.source !== "chain" || !address) return null;
  const token = market?.debt.token ?? null;
  return (
    <Card as="section" data-testid="account-repays" data-count={repays.data?.events.length ?? ""}>
      <CardHeader eyebrow="On chain" title="Automated repayments on this account" description="AutoRepayExecuted events emitted by your Sentinel account in mined transactions, whoever sent them." />
      {repays.isPending ? (
        <Skeleton className="m-5 h-20" />
      ) : repays.isError || !repays.data ? (
        <p className="p-5 text-sm text-muted sm:p-6">The account's events could not be read right now. This says nothing about whether a repayment happened.</p>
      ) : (
        <>
          {repays.data.events.length === 0 ? (
            <p className="p-5 text-sm text-muted sm:p-6">No automated repayment{repays.data.coverage.complete ? " has been executed for this account." : " was found in the blocks that were read."}</p>
          ) : (
            <ul className="divide-y divide-line">
              {repays.data.events.map((event) => {
                const url = explorerTxUrl(WRITE_CHAIN_ID, event.hash);
                return (
                  <li key={event.hash} className="p-5 text-sm sm:px-6" data-account-repay={event.hash}>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge tone="success">Mined</Badge>
                      <Badge tone="outline">Operator</Badge>
                    </div>
                    <p className="num mt-1.5 text-muted">
                      Repaid {token ? tokenAmount(event.amount, token) : `${event.amount.toString()} raw units`}, loan-to-value {formatBps(event.ltvBeforeBps)} → {formatBps(event.ltvAfterBps)}, block {event.blockNumber.toString()}, operator <Mono>{shortAddress(event.operator)}</Mono>.
                    </p>
                    <p className="mt-1 text-xs">
                      {url ? (
                        <a href={url} target="_blank" rel="noreferrer" className="font-medium underline underline-offset-4" data-testid="account-repay-link">
                          {shortHash(event.hash)} on the explorer
                        </a>
                      ) : (
                        <span className="font-mono break-all text-faint">{event.hash}</span>
                      )}
                    </p>
                  </li>
                );
              })}
            </ul>
          )}
          {repays.data.coverage.complete ? null : (
            <p className="border-t border-line px-5 py-3 text-xs text-faint sm:px-6">
              <LogCoverageText coverage={repays.data.coverage} />
            </p>
          )}
        </>
      )}
    </Card>
  );
}

/** Sentinel Connect (MCP). Described, not offered: nothing on this card can be switched on. */
function ConnectSection() {
  const run = CONNECT.transcript.status === "ok" ? CONNECT.transcript.value : null;
  const tools = CONNECT.tools.status === "ok" ? CONNECT.tools.value.tools : [];
  const txUrl = run ? explorerTxUrl(run.chainId, run.step5.hash) : null;
  return (
    <Card as="section" id="connect" className="scroll-mt-28" data-mode="connect" data-availability={CONNECT_AVAILABILITY}>
      <CardHeader
        eyebrow="Mode 2 · Sentinel Connect"
        title="Bring your own agent"
        description="A local MCP server that lets an agent you run work with a Sentinel account through typed tools. Agent-directed: it acts when your agent calls a tool, and does not watch the account on its own."
        action={<AvailabilityBadge status={CONNECT_AVAILABILITY} label={CONNECT_AVAILABILITY === "live" ? CONNECT_STATUS_LABEL : undefined} />}
      />
      <div className="space-y-4 p-5 text-sm sm:p-6">
        {CONNECT_AVAILABILITY === "live" && run ? (
          <p className="text-muted" data-testid="connect-summary">
            Verified on X Layer testnet with a scripted external MCP client: {tools.length} tools, {tools.filter((tool) => tool.kind === "execute").length} of which can send a transaction. In the recorded run the agent repaid{" "}
            <span className="num text-fg">
              {formatAmount(run.step5.amountRaw, run.debt.decimals)} {run.debt.symbol}
            </span>{" "}
            under a repay-only grant
            {txUrl ? (
              <>
                {" "}
                (
                <a href={txUrl} target="_blank" rel="noreferrer" className="font-mono text-[0.8125rem] text-fg underline underline-offset-4">
                  {shortHash(run.step5.hash)}
                </a>
                )
              </>
            ) : null}
            , and its attempt to borrow was refused by the account contract in a simulation.
          </p>
        ) : (
          <p className="text-muted">Sentinel Connect is not shown as available in this build: its recorded testnet run is missing.</p>
        )}
        <div>
          <h3 className="font-medium">Limits</h3>
          <ul className="mt-2 list-disc space-y-1.5 pl-5 text-muted">
            <li>The agent reads the account, its policy and the remaining authorisation, asks for a quote, and simulates.</li>
            <li>It can execute one kind of operation: a repayment from the account's own funds, under the operator authorisation the owner granted.</li>
            <li>No arbitrary calldata, no owner key, and no tool that withdraws or changes permissions.</li>
            <li>The emergency stop on this page revokes the agent's operator like any other.</li>
          </ul>
        </div>
        <ButtonLink href="/connect" variant="secondary" size="sm" data-testid="connect-open">
          Tools, setup and the recorded run
        </ButtonLink>
      </div>
    </Card>
  );
}
