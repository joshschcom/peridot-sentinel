"use client";
/**
 * Sentinel Connect: bring your own agent, over MCP.
 *
 * Everything on this page is either recorded evidence (the tool catalogue and the seven-step run by an external MCP
 * client on public testnet 1952) or a live public read of the grant that run acted under. The page itself connects
 * nothing and signs nothing: it has no input for a key and no button that sends a transaction.
 *
 * Wording: "agent-directed execution". The server acts when its host calls a tool; it does not monitor anything.
 */
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { type ReactNode, useState } from "react";
import { Badge, Button, ButtonLink, Card, CardHeader, DefinitionRow, Mono, Notice, PageHeader, Skeleton } from "@/components/ui/core";
import { IconAlert, IconArrowUpRight, IconCheck, IconX } from "@/components/ui/icons";
import { formatAmount, formatBps } from "@/lib/amount";
import { TARGET_KIND, explorerAddressUrl, explorerTxUrl, xLayerTestnet } from "@/lib/chains";
import { CONNECT, CONNECT_EXECUTE_ENV, CONNECT_SCOPE_LABEL, CONNECT_SETUP_COMMANDS, CONNECT_STATUS_LABEL, CONNECT_STDIO_COMMAND, type ConnectToolKind, type ConnectTranscript, LLM_SESSION_LABEL, LLM_SESSION_SCOPE, type LlmSession, connectVerified, grantReadiness } from "@/lib/connect";
import { RAW_CONFIG } from "@/generated/config";
import { EXPANSION } from "@/lib/expansion";
import { shortAddress, shortHash } from "@/lib/format";
import { Op } from "@/lib/policy";
import { readConnectGrant } from "@/services/chain/connect";
import { JUDGE, JudgeCampaignCard } from "./judge-campaign";
import { FORCE_FIXTURE } from "@/services/runtime";
import type { Address } from "@/services/types";

const num = (value: string | bigint) => Number(value).toLocaleString("en-US");
const utc = (seconds: bigint) => `${new Date(Number(seconds) * 1000).toISOString().slice(0, 16).replace("T", " ")} UTC`;

const CAN = [
  "Read the account: holdings, supplied collateral, stored debt, markets, rates.",
  "Read both policies and the operator authorisation: operations, remaining budget, expiry, trigger.",
  "Ask for an informational price quote. Without provider credentials the answer is “unavailable”, with no number.",
  "Simulate the repayment, then record a proposal that is valid for five minutes.",
  "Execute ONE restricted operation: a zero-value call to the account's autoRepay(). The contract sets the amount: the smallest of the debt, the account's idle funds and what is left of the grant.",
];
const CANNOT = [
  "Hold or use the owner's key. The server is given an operator key by its host, nothing else.",
  "Withdraw. Withdrawals are owner-only in the account contract.",
  "Change permissions, the policy or the trigger. There is no tool for it, and the contract refuses an operator.",
  "Borrow, or do anything outside the grant. The recorded runs tried: the contract answered OperatorNotAuthorized, in a simulation and in a mined transaction.",
  "Send arbitrary calldata, or choose the recipient, the amount, the chain or the account. The execute tool takes a proposal ID and nothing else.",
  "Act after the owner revokes the operator, after the expiry, or once the budget is spent.",
];
const KIND_LABEL: Record<ConnectToolKind, string> = { read: "Read-only", proposal: "Local proposal · no transaction", execute: "Sends one restricted transaction" };

export function Connect() {
  const verified = connectVerified();
  const run = CONNECT.transcript.status === "ok" ? CONNECT.transcript.value : null;
  const llm = CONNECT.llm.status === "ok" ? CONNECT.llm.value : null;
  return (
    <div className="space-y-6" data-testid="connect" data-connect={verified ? "available" : "unavailable"}>
      <PageHeader
        eyebrow="Sentinel Connect"
        title="Bring your own agent"
        description="A local MCP server gives an agent you run typed tools for a Sentinel account: read, simulate, and one restricted execution under the operator authorisation the owner granted. This is agent-directed execution: the server acts only when your agent calls a tool. It does not watch the account on its own."
        actions={<Badge tone={verified ? "success" : "warning"}>{verified ? CONNECT_STATUS_LABEL : "In development"}</Badge>}
      />
      <Notice title="Testnet only" data-testid="connect-scope">
        {CONNECT_SCOPE_LABEL}. The recorded runs used an external MCP client in a separate process: a scripted client, and one session directed by a language model. Neither is a model hosted by Peridot: no hosted AI exists in this app, and nothing monitors an account between sessions.
      </Notice>

      <p className="text-sm">
        <a href="#onboarding" className="font-medium underline underline-offset-4" data-testid="connect-onboarding-link">
          How to connect your own LLM
        </a>
        <span className="text-muted"> · </span>
        <a href="#llm-session" className="font-medium underline underline-offset-4">
          The verified LLM-directed session
        </a>
        <span className="text-muted"> · </span>
        <a href="#run" className="font-medium underline underline-offset-4">
          The scripted seven-step run
        </a>
        {JUDGE.status === "ok" ? (
          <>
            <span className="text-muted"> · </span>
            <a href="#judge" className="font-medium underline underline-offset-4" data-testid="connect-judge-link">
              The prepared judge campaign
            </a>
          </>
        ) : null}
      </p>
      <Card as="section" data-testid="connect-limits">
        <CardHeader title="What an agent can and cannot do" description="The limits are in the account contract and in the tool list, not in a promise from the agent." />
        <div className="grid gap-6 p-5 sm:p-6 lg:grid-cols-2">
          <Limits title="It can" items={CAN} icon={<IconCheck size={16} className="text-success" />} testid="connect-can" />
          <Limits title="It cannot" items={CANNOT} icon={<IconX size={16} className="text-danger" />} testid="connect-cannot" />
        </div>
      </Card>

      <EvidenceKinds run={run} llm={llm} />
      {llm ? <LlmSessionCard session={llm} /> : null}
      {run ? <LiveGrant run={run} /> : null}
      <Tools />
      <HowToConnect llm={llm} />
      <JudgeCampaignCard />
      <JudgeWalkthrough />
      {run ? (
        <Transcript run={run} />
      ) : (
        <Notice tone="warning" icon={<IconAlert size={18} />} title="The recorded run is not in this build">
          {CONNECT.transcript.status === "unavailable" ? CONNECT.transcript.reason : null}
        </Notice>
      )}
    </div>
  );
}

function Limits({ title, items, icon, testid }: { title: string; items: string[]; icon: ReactNode; testid: string }) {
  return (
    <div data-testid={testid}>
      <h3 className="text-sm font-medium">{title}</h3>
      <ul className="mt-3 space-y-2.5 text-sm text-muted">
        {items.map((item) => (
          <li key={item} className="flex gap-2.5">
            <span className="mt-0.5 shrink-0">{icon}</span>
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ---------- what has been shown, by kind ---------- */

/**
 * Four kinds of evidence that must never be blurred into each other:
 *   a scripted MCP client run (recorded, verified), an LLM-directed session (none recorded yet: the slot stays
 *   "Pending" until its transcript is in the repository), a simulated rejection (eth_call, nothing mined) and a
 *   mined revert (a transaction that reverted on chain; none exists for Sentinel Connect).
 */
function EvidenceKinds({ run, llm }: { run: ConnectTranscript | null; llm: LlmSession | null }) {
  const txUrl = run ? explorerTxUrl(run.chainId, run.step5.hash) : null;
  return (
    <Card as="section" id="evidence" className="scroll-mt-28" data-testid="connect-evidence">
      <CardHeader title="What has been shown, and how" description="Each row is a different kind of evidence. A simulation is never presented as a transaction, and a scripted client is never presented as a language model." />
      <ul className="divide-y divide-line px-5 pb-2 text-sm sm:px-6">
        <EvidenceRow kind="scripted" name="Scripted MCP client" badge={run ? "Verified" : "Not in this build"} tone={run ? "success" : "outline"}>
          {run ? (
            <>
              A scripted external MCP client, in its own process, ran the seven steps below on X Layer testnet and sent one transaction:{" "}
              {txUrl ? (
                <a href={txUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-mono text-[0.8125rem] text-fg underline underline-offset-4">
                  {shortHash(run.step5.hash)} <IconArrowUpRight size={13} />
                </a>
              ) : (
                <Mono>{shortHash(run.step5.hash)}</Mono>
              )}
              . The steps were chosen by a script, not by a model.
            </>
          ) : (
            "The recorded run is not available in this build."
          )}
        </EvidenceRow>
        {llm ? (
          <EvidenceRow kind="llm" name="LLM-directed session" badge="Verified" tone="success">
            {LLM_SESSION_LABEL}. The model ({llm.model}) chose the operation and the amounts itself, within the grant, and sent one swap:{" "}
            <TxAnchor hash={llm.swap.hash} />. Details in{" "}
            <a href="#llm-session" className="text-fg underline underline-offset-4">
              the session below
            </a>
            .
          </EvidenceRow>
        ) : (
          <EvidenceRow kind="llm" name="LLM-directed session" badge="Pending" tone="warning">
            No session directed by a language model is recorded in this build. This row stays pending until a verified transcript of a real session is in the repository. Nothing on this page comes from one.
          </EvidenceRow>
        )}
        <EvidenceRow kind="simulated-rejection" name="Simulated rejection" badge={run ? "Recorded · nothing sent" : "Not in this build"} tone="outline">
          {run ? (
            <>
              Step 6: the operator's {run.step6.operation} was refused with <Mono>{run.step6.error}</Mono> in a read-only {run.step6.method} of the account's real entrypoint. It is a simulation: it has no transaction hash.
            </>
          ) : (
            "The recorded run is not available in this build."
          )}
        </EvidenceRow>
        {llm ? (
          <EvidenceRow kind="mined-revert" name="Mined revert" badge="Recorded · reverted on chain" tone="danger">
            In the LLM-directed session the operator's borrow was first refused in a simulation and then actually sent: it reverted on chain with <Mono>{llm.rejection.minedError}</Mono>, <TxAnchor hash={llm.rejection.mined.hash} />. A mined revert has a hash and a failed receipt. The step-6 rejection of the scripted run above remains a simulation.
          </EvidenceRow>
        ) : (
          <EvidenceRow kind="mined-revert" name="Mined revert" badge="None recorded" tone="outline">
            No reverted transaction has been mined for Sentinel Connect in this build. The rejection above is not presented as one.
          </EvidenceRow>
        )}
      </ul>
    </Card>
  );
}

function TxAnchor({ hash }: { hash: string }) {
  const url = explorerTxUrl(1952, hash);
  return url ? (
    <a href={url} target="_blank" rel="noreferrer" className="font-mono text-[0.8125rem] break-all text-fg underline underline-offset-4" data-tx={hash}>
      {shortHash(hash)} <IconArrowUpRight size={13} />
    </a>
  ) : (
    <Mono>{shortHash(hash)}</Mono>
  );
}

/**
 * The LLM-directed session: one headless session of a language model over MCP, recorded and independently re-read
 * from the public testnet. A single session, started by a person. Not continuous, not autonomous monitoring.
 */
function LlmSessionCard({ session }: { session: LlmSession }) {
  const tin = (raw: bigint) => `${formatAmount(raw, session.tokenIn.decimals)} mWOKB`;
  const tout = (raw: bigint) => `${formatAmount(raw, session.tokenOut.decimals, { maxFractionDigits: 6 })} mUSDC`;
  return (
    <Card as="section" id="llm-session" className="scroll-mt-28" data-testid="connect-llm" data-swap={session.swap.hash} data-revert={session.rejection.mined.hash} data-deltas={String(session.swap.deltasMatch)}>
      <CardHeader
        eyebrow="Recorded · X Layer testnet (chain 1952) · Sentinel v2"
        title="A language model directed one session"
        description={
          <>
            {LLM_SESSION_LABEL}. Scope: {LLM_SESSION_SCOPE}. The model was {session.model}, run headless with only the Sentinel tools; the operator key lived in the MCP server process and was never shown to the model. Verified record: <Mono>{session.file}</Mono>.
          </>
        }
        action={<Badge tone="success" wrap>LLM-directed · verified</Badge>}
      />
      <div className="space-y-5 p-5 text-sm sm:p-6">
        <dl className="divide-y divide-line">
          <DefinitionRow stack label="What the model proposed">
            <span data-testid="llm-proposal">
              Swap {tin(session.chosen.amountInRaw)} for at least {tout(session.chosen.minOutRaw)} · proposal <Mono>{shortHash(session.chosen.proposalId)}</Mono>
            </span>
          </DefinitionRow>
          {session.venue ? (
            <DefinitionRow stack label="What the mock venue expected">
              {tout(session.venue.expectedOutRaw)} · policy minimum {tout(session.venue.policyMinimumOutRaw)} · hard minimum {tout(session.venue.hardMinimumOutRaw)}
            </DefinitionRow>
          ) : null}
          <DefinitionRow stack label="OKX quote asked for by the session">
            <span data-testid="llm-quote" data-available={String(session.quote !== null)}>
              {session.quote ? `${session.quote.source}, chain ${session.quote.chainId}, observed ${session.quote.observedAt.slice(0, 19).replace("T", " ")} UTC: ${formatAmount(session.quote.amountInRaw, session.quote.tokenIn.decimals, { maxFractionDigits: 6 })} ${session.quote.tokenIn.symbol} for ${formatAmount(session.quote.amountOutRaw, session.quote.tokenOut.decimals, { maxFractionDigits: 6 })} ${session.quote.tokenOut.symbol} (informational)` : `Quote unavailable${session.quoteReason ? ` (${session.quoteReason})` : ""}. No number is shown.`}
            </span>
          </DefinitionRow>
          <DefinitionRow stack label="Swap · operator execution · mock venue">
            <TxAnchor hash={session.swap.hash} /> · block {num(session.swap.block)}
          </DefinitionRow>
          <DefinitionRow stack label="Verified before → after">
            <span data-testid="llm-deltas">
              idle {tin(session.swap.idleInBeforeRaw)} → {tin(session.swap.idleInAfterRaw)} · idle {tout(session.swap.idleOutBeforeRaw)} → {tout(session.swap.idleOutAfterRaw)} · swap grant {tin(session.swap.grantBeforeRaw)} → {tin(session.swap.grantAfterRaw)}
            </span>
            <span className={`mt-1 block text-xs ${session.swap.deltasMatch ? "text-success" : "text-danger"}`}>{session.swap.deltasMatch ? "Spent, received and charged amounts add up, and the output went to the account." : "The recorded amounts do not add up."}</span>
          </DefinitionRow>
          <DefinitionRow stack label="Borrow attempt · simulated denial">
            <span data-testid="llm-simulated">
              <Mono>{session.rejection.simulatedError}</Mono> in an eth_call · nothing sent · no hash
            </span>
          </DefinitionRow>
          <DefinitionRow stack label="Borrow attempt · mined revert">
            <span data-testid="llm-mined">
              <TxAnchor hash={session.rejection.mined.hash} /> · block {num(session.rejection.mined.block)} · <Mono>{session.rejection.minedError}</Mono>
              {session.rejection.statePreserved ? " · grants, balances and allowances unchanged" : ""}
            </span>
          </DefinitionRow>
        </dl>
        {session.transcript ? (
          <details className="rounded-control border border-line" data-testid="llm-reasoning">
            <summary className="flex min-h-11 cursor-pointer items-center px-3.5 text-sm font-medium text-muted hover:text-fg">The model's own final message, quoted verbatim</summary>
            <div className="border-t border-line p-3.5">
              <p className="text-xs text-faint">
                Unedited text written by the model at the end of the session{session.transcript.turns ? ` (${session.transcript.turns} turns)` : ""}, from <Mono>{session.transcript.file}</Mono>. It is the model's account of what it did. The rows above come from the independent re-read of the chain, not from this text.
              </p>
              <blockquote className="mt-3 max-h-[32rem] overflow-auto border-l-2 border-line-strong pl-3.5 font-mono text-[0.8125rem] leading-relaxed whitespace-pre-wrap">{session.transcript.result}</blockquote>
            </div>
          </details>
        ) : null}
        <p className="text-xs text-faint">One session, started by a person, on a demonstration account. Nothing runs between sessions: no model watches this account, and the owner can revoke the operator at any time.</p>
      </div>
    </Card>
  );
}

function EvidenceRow({ kind, name, badge, tone, children }: { kind: string; name: string; badge: string; tone: "success" | "warning" | "outline" | "danger"; children: ReactNode }) {
  return (
    <li className="grid gap-x-4 gap-y-1.5 py-3.5 grid-cols-1 md:grid-cols-[13rem_minmax(0,1fr)_auto] md:items-baseline" data-evidence={kind} data-status={badge}>
      <span className="font-medium">{name}</span>
      <span className="min-w-0 text-muted">{children}</span>
      <span>
        <Badge tone={tone} wrap>
          {badge}
        </Badge>
      </span>
    </li>
  );
}

/* ---------- the grant, live ---------- */

function LiveGrant({ run }: { run: ConnectTranscript }) {
  // The live read exists for the public testnet only. A local-target or example-data build shows the record alone.
  const enabled = TARGET_KIND === "testnet" && !FORCE_FIXTURE;
  const live = useQuery({
    queryKey: ["connect-grant", run.account, run.operator],
    queryFn: () => readConnectGrant(run.account as Address, run.operator as Address),
    enabled,
    staleTime: 30_000,
    retry: 1,
  });
  const data = live.data;
  const readiness = data ? grantReadiness({ opsMask: data.opsMask, remaining: data.remaining, expiry: data.expiry }, data.blockTime, Op.REPAY) : null;
  const amount = (raw: bigint) => `${formatAmount(raw, run.debt.decimals)} ${run.debt.symbol}`;
  const accountUrl = explorerAddressUrl(xLayerTestnet.id, run.account);
  const state = !enabled ? "off" : live.isPending ? "loading" : live.isError || !data ? "error" : "ok";

  return (
    <Card as="section" id="grant" className="scroll-mt-28" data-testid="connect-grant" data-state={state} data-readiness={readiness ?? ""} data-remaining={data ? data.remaining.toString() : ""} data-mask={data ? String(data.opsMask) : ""} data-expiry={data ? data.expiry.toString() : ""} data-block={data ? data.block.toString() : ""}>
      <CardHeader
        eyebrow={enabled ? "Live · X Layer testnet (chain 1952)" : "Recorded"}
        title="The authorisation the agent acts under"
        description="One operator grant on one Sentinel account. Only the account's owner can set, replace or revoke it."
        action={enabled ? <Badge tone={live.isError ? "danger" : data ? "success" : "neutral"}>{live.isError ? "Unavailable" : data ? "Live read" : "Reading…"}</Badge> : <Badge tone="outline">Live read off</Badge>}
      />
      {!enabled ? (
        <div className="space-y-3 p-5 text-sm sm:p-6">
          <p className="text-muted">
            {TARGET_KIND === "local" ? "This build targets the local development chain. The Sentinel Connect grant lives on X Layer testnet, so it is not read here." : "This build runs on example data and makes no chain reads."} At the end of the recorded run the grant was{" "}
            <span className="num text-fg">{amount(run.step7.grant.remainingRaw)}</span> at testnet block {num(run.step7.block.number)}.
          </p>
        </div>
      ) : live.isPending ? (
        <Skeleton className="m-5 h-40" data-loading />
      ) : live.isError || !data || !readiness ? (
        <div className="space-y-3 p-5 sm:p-6">
          <Notice tone="danger" icon={<IconAlert size={18} />} title="The grant could not be read">
            {live.error instanceof Error ? live.error.message.split("\n")[0] : "The public testnet RPC did not answer."} Nothing is shown in its place. The recorded run below is unaffected.
          </Notice>
          <Button size="sm" variant="secondary" onClick={() => void live.refetch()} disabled={live.isFetching}>
            {live.isFetching ? "Reading…" : "Try again"}
          </Button>
        </div>
      ) : (
        <div className="space-y-4 p-5 sm:p-6">
          <Notice tone={readiness === "ready" ? "success" : "warning"} icon={readiness === "ready" ? <IconCheck size={18} /> : <IconAlert size={18} />} title={READINESS_TITLE[readiness]} data-testid="connect-readiness">
            {READINESS_BODY[readiness]}
          </Notice>
          <dl className="divide-y divide-line">
            <DefinitionRow stack label="Sentinel account" mono>
              {accountUrl ? (
                <a href={accountUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 break-all underline underline-offset-4">
                  {data.account} <IconArrowUpRight size={13} />
                </a>
              ) : (
                data.account
              )}
            </DefinitionRow>
            <DefinitionRow stack label="Owner" mono>
              {shortAddress(data.owner)}
            </DefinitionRow>
            <DefinitionRow stack label="Operator (the agent's key)" mono>
              {shortAddress(data.operator)}
            </DefinitionRow>
            <DefinitionRow stack label="May do">
              <span data-testid="connect-grant-ops">{opsText(data.opsMask)}</span>
            </DefinitionRow>
            <DefinitionRow stack label="Budget left">
              <span data-testid="connect-grant-remaining">{amount(data.remaining)}</span>
            </DefinitionRow>
            <DefinitionRow stack label="Expires">
              <span data-testid="connect-grant-expiry">{data.expiry === 0n ? "No expiry set" : `${utc(data.expiry)}${data.expiry <= data.blockTime && data.opsMask !== 0 ? " · expired" : ""}`}</span>
            </DefinitionRow>
            <DefinitionRow stack label="Repay trigger">{data.triggerBps === 0 ? "Off" : `Loan-to-value at or above ${formatBps(data.triggerBps)}`}</DefinitionRow>
            <DefinitionRow stack label="Read at block">
              <span className="num" data-testid="connect-grant-block">
                {num(data.block)}
              </span>{" "}
              · {utc(data.blockTime)} · <Mono>{shortHash(data.blockHash)}</Mono>
            </DefinitionRow>
          </dl>
          <div className="flex flex-wrap items-center gap-3 text-xs text-faint">
            <Button size="sm" variant="secondary" onClick={() => void live.refetch()} disabled={live.isFetching} data-testid="connect-grant-refresh">
              {live.isFetching ? "Reading…" : "Read again"}
            </Button>
            <ButtonLink href="/strategies" size="sm" variant="secondary">
              Owner controls and emergency stop
            </ButtonLink>
            <span>
              Every value above was read at that one block from <Mono>{xLayerTestnet.rpcUrls.default.http[0]}</Mono>. No wallet is involved.
            </span>
          </div>
        </div>
      )}
    </Card>
  );
}

const READINESS_TITLE = {
  ready: "An agent can execute one repayment now",
  spent: "Nothing left to spend: an agent cannot execute now",
  expired: "The grant has expired: an agent cannot execute now",
  revoked: "No authorisation: an agent cannot execute now",
  "not-repay-only": "The grant is wider than repay-only",
} as const;
const READINESS_BODY = {
  ready: "The grant is repay-only, funded and unexpired. Whether a repayment goes through still depends on the account's trigger and debt at that moment: the contract decides.",
  spent: "The budget of this grant has been used up. The read and simulate tools keep working. Before another execution, the account's owner has to grant a new budget on chain.",
  expired: "Grants carry an expiry. The read and simulate tools keep working. Before another execution, the account's owner has to grant again on chain.",
  revoked: "This operator has no permission on the account. The read tools keep working. Only the account's owner can grant one.",
  "not-repay-only": "The Sentinel Connect server refuses to sign unless the grant is exactly repay-only. The owner should replace this grant.",
} as const;

function opsText(mask: number): string {
  if (mask === 0) return "Nothing";
  if (mask === 1 << Op.REPAY) return "Repay debt from the account's own idle funds. Nothing else.";
  return `Operation mask ${mask} (more than repay)`;
}

/* ---------- tools ---------- */

function Tools() {
  if (CONNECT.tools.status !== "ok") {
    return (
      <Notice tone="warning" icon={<IconAlert size={18} />} title="The tool list is not in this build">
        {CONNECT.tools.reason}
      </Notice>
    );
  }
  const { tools, server, version } = CONNECT.tools.value;
  const executes = tools.filter((tool) => tool.kind === "execute").length;
  return (
    <Card as="section" id="tools" className="scroll-mt-28" data-testid="connect-tools" data-count={tools.length} data-execute-count={executes}>
      <CardHeader
        title={`${tools.length} tools, ${executes} of them can send a transaction`}
        description={
          <>
            The catalogue of the server <Mono>{server}</Mono> {version}, read from <Mono>{CONNECT.toolsFile}</Mono> in the repository. A test in the server's own suite keeps that file equal to the tools the server registers.
          </>
        }
      />
      <ul className="divide-y divide-line px-5 pb-2 sm:px-6">
        {tools.map((tool) => (
          <li key={tool.name} className="grid gap-x-4 gap-y-1 py-3 text-sm grid-cols-1 md:grid-cols-[17rem_minmax(0,1fr)_auto] md:items-baseline" data-tool={tool.name} data-kind={tool.kind}>
            <Mono className="font-medium">{tool.name}</Mono>
            <span className="text-muted">
              {tool.description}
              {tool.inputs.length > 0 ? (
                <span className="text-faint">
                  {" "}
                  Input: <Mono>{tool.inputs.join(", ")}</Mono>.
                </span>
              ) : null}
              <ToolGuarantees guarantees={tool.guarantees} />
            </span>
            <span>
              <Badge tone={tool.kind === "execute" ? "warning" : "outline"} wrap>
                {KIND_LABEL[tool.kind]}
              </Badge>
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/** What the server states it checks before a tool answers, verbatim from the catalogue. Closed by default. */
function ToolGuarantees({ guarantees }: { guarantees: string[] }) {
  if (guarantees.length === 0) return null;
  return (
    <details className="mt-1 text-[0.8125rem]" data-tool-guarantees={guarantees.length}>
      <summary className="cursor-pointer text-faint hover:text-fg">What the server checks</summary>
      <ul className="mt-1 list-disc space-y-1 pl-4 text-muted">
        {guarantees.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </details>
  );
}

/* ---------- how to connect ---------- */

function Code({ children, testid }: { children: string; testid?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    // Copying is a convenience. If the browser refuses the clipboard, the text is still there to select.
    try {
      await navigator.clipboard.writeText(children);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };
  return (
    <div className="relative">
      <pre className="overflow-x-auto rounded-control border border-line bg-subtle p-3.5 pr-20 font-mono text-[0.8125rem] leading-relaxed" data-testid={testid}>
        {children}
      </pre>
      <button type="button" onClick={() => void copy()} className="absolute top-2 right-2 h-8 rounded-control border border-line-strong bg-bg px-2.5 text-xs font-medium text-muted hover:text-fg" data-copy aria-label="Copy to clipboard">
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

function OnboardStep({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <li className="grid grid-cols-1 gap-x-5 gap-y-2 py-5 md:grid-cols-[2.5rem_minmax(0,1fr)]" data-onboard-step={n}>
      <span className="num grid size-8 place-items-center rounded-full bg-inverse text-sm font-medium text-on-inverse">{n}</span>
      <div className="min-w-0 space-y-2.5">
        <h3 className="text-sm font-semibold">{title}</h3>
        <div className="space-y-2.5 text-sm text-muted">{children}</div>
      </div>
    </li>
  );
}

const V1_READ_ONLY_PROMPT = "Read the Sentinel account's positions, both policies and the operator authorisation. Simulate the auto-repay and tell me whether it is eligible and for how much. Then simulate the operator's borrow and tell me what the contract answers. Do not execute anything.";

/**
 * Onboarding: how to connect your own LLM. Every command, configuration and prompt shown is a file in the repository
 * or derived from one (src/generated/config.ts), so a reader who follows it runs exactly what was recorded.
 * No key is ever typed into this page: it has no input, and the operator key belongs to the MCP server's environment.
 */
function HowToConnect({ llm }: { llm: LlmSession | null }) {
  const hostConfig = JSON.stringify({ mcpServers: { "sentinel-connect": { command: "node", args: [CONNECT_STDIO_COMMAND.replace(/^node /, "")] } } }, null, 2);
  const onboarding = RAW_CONFIG.onboarding;
  const v2 = CONNECT.toolsV2.status === "ok" ? CONNECT.toolsV2.value : null;
  const v2Tools = v2?.tools ?? [];
  const v2Sending = v2Tools.filter((tool) => tool.kind === "execute");
  const demo = EXPANSION.demo.status === "ok" ? EXPANSION.demo.value : null;
  return (
    <Card as="section" id="onboarding" className="scroll-mt-28" data-testid="connect-how">
      <CardHeader
        eyebrow="Onboarding"
        title="Connect your own LLM"
        description="Sentinel Connect is an MCP server you run next to an LLM runtime you also run, such as Claude Code or any other MCP client. They talk over stdio on your machine. There is no hosted AI: Peridot runs no model, and this website is not part of the connection."
      />
      <ol className="divide-y divide-line px-5 sm:px-6">
        <OnboardStep n={1} title="Prepare a checkout (Node 22.13 or later)">
          <Code>{CONNECT_SETUP_COMMANDS.join("\n")}</Code>
          <p className="text-xs text-faint">The last line starts the server in a separate process and lists its tools. It needs no key.</p>
        </OnboardStep>
        <OnboardStep n={2} title="Add the server to your MCP client, without a key">
          <p>Give your MCP client this stdio command, or the JSON below if it takes a configuration file. Replace the path with your checkout.</p>
          <Code testid="connect-command">{CONNECT_STDIO_COMMAND}</Code>
          <Code testid="connect-config">{hostConfig}</Code>
          <p className="text-xs text-faint">Started like this the server holds no key. Every read, quote and simulate tool works against X Layer testnet, and the execute tool answers EXECUTION_DISABLED.</p>
        </OnboardStep>
        <OnboardStep n={3} title="Ask it something that only reads">
          <Code testid="connect-prompt-read">{V1_READ_ONLY_PROMPT}</Code>
          <p className="text-xs text-faint">An example prompt for the keyless setup. The account is the public demonstration account; the tools take no address, so the model cannot be pointed at another one.</p>
        </OnboardStep>
        <OnboardStep n={4} title="To let it execute: a bounded, expiring operator, granted by the owner">
          <p>
            Execution needs two things from two different people. The account's <span className="text-fg">owner</span> grants an operator address on chain: which operation, how much in total, until when. For a v1 account that is done in this app, on{" "}
            <Link href="/strategies#rules" className="text-fg underline underline-offset-4">
              Strategies
            </Link>
            , with the owner's wallet. The <span className="text-fg">person running the MCP server</span> starts it with that operator's key in the server's environment:
          </p>
          <Code>{CONNECT_EXECUTE_ENV.join("\n")}</Code>
          <p className="text-xs text-faint" data-testid="connect-key-note">
            The operator key stays in the environment of the MCP server process. It is never entered on this page: there is no field for it here, the app never sees it, and the model never sees it either. Give it only to a server you run yourself. The operator can do the one granted operation and nothing else; it can never withdraw.
          </p>
        </OnboardStep>
        <OnboardStep n={5} title={v2 ? `The v2 server: a swap campaign with ${v2Tools.length} tools, ${v2Sending.length} of which can send a transaction` : "The v2 server: a swap campaign"}>
          <p>
            The session in which a language model chose and executed a swap used the v2 server{v2 ? <> (<Mono>{v2.server}</Mono> {v2.version})</> : null}. Its launcher starts the signer and the model as separate processes joined by a private socket, so the key is in neither the model's process nor its configuration:
          </p>
          <Code>bash services/mcp-v2/run-claude.sh</Code>
          {onboarding.v2Config.text ? (
            <>
              <p>
                The MCP configuration it gives the model, verbatim from <Mono>{onboarding.v2Config.file}</Mono>:
              </p>
              <Code testid="connect-config-v2">{onboarding.v2Config.text.trim()}</Code>
            </>
          ) : null}
          {v2Tools.length > 0 ? (
            <>
              <ul className="divide-y divide-line rounded-control border border-line" data-testid="connect-tools-v2" data-count={v2Tools.length} data-execute-count={v2Sending.length}>
                {v2Tools.map((tool) => (
                  <li key={tool.name} className="px-3.5 py-2.5" data-tool-v2={tool.name} data-kind={tool.kind}>
                    <span className="flex flex-wrap items-center justify-between gap-2">
                      <Mono className="font-medium text-fg">{tool.name}</Mono>
                      <Badge tone={tool.kind === "execute" ? "warning" : "outline"} wrap>
                        {KIND_LABEL[tool.kind]}
                      </Badge>
                    </span>
                    <span className="mt-1 block">
                      {tool.description}
                      {tool.inputs.length > 0 ? (
                        <span className="text-faint">
                          {" "}
                          Input: <Mono>{tool.inputs.join(", ")}</Mono>.
                        </span>
                      ) : null}
                    </span>
                    <ToolGuarantees guarantees={tool.guarantees} />
                  </li>
                ))}
              </ul>
              <p className="text-xs text-faint" data-testid="connect-tools-v2-source">
                From <Mono>{CONNECT.toolsV2File}</Mono>. {v2Sending.length} of these tools can send: {v2Sending.map((tool) => tool.name).join(" and ")}. Each takes only the id of a proposal the server simulated and saved itself, and the campaign allows each at most once.
              </p>
            </>
          ) : (
            <p className="text-xs text-warning">The v2 tool catalogue is not in this build{CONNECT.toolsV2.status === "unavailable" ? `: ${CONNECT.toolsV2.reason}` : ""}.</p>
          )}
          <p className="text-xs text-faint">It needs a live swap grant from the account's owner and the operator key in the launcher's environment. Without them, use the keyless setup in steps 1 to 3. The model is given these tools only: it has no shell, no file access and no tool that takes calldata, a recipient or another account. The launcher also switches on the one-off mined-rejection tool, and it writes the session's transcript to a file.</p>
        </OnboardStep>
        {onboarding.v2Objective.text ? (
          <OnboardStep n={6} title="An objective that was really used">
            <p>
              The owner's objective of the recorded session, verbatim from <Mono>{onboarding.v2Objective.file}</Mono>. The model decided the amounts itself.
            </p>
            <Code testid="connect-objective">{onboarding.v2Objective.text.trim()}</Code>
            {llm ? (
              <p>
                <a href="#llm-session" className="font-medium text-fg underline underline-offset-4" data-testid="connect-session-link">
                  See what the model did with it: the verified session
                </a>
                .
              </p>
            ) : null}
          </OnboardStep>
        ) : null}
        <OnboardStep n={onboarding.v2Objective.text ? 7 : 6} title="Stopping it">
          <p>
            The owner can end an agent's authority at any moment, on chain, without the agent's cooperation. For a v1 account: the{" "}
            <Link href="/strategies" className="text-fg underline underline-offset-4" data-testid="connect-stop-link">
              emergency stop on Strategies
            </Link>{" "}
            revokes the operators and clears the trigger. A v2 account has one call that revokes every operator at once
            {demo?.emergencyRevoke ? (
              <>
                ; the demonstration account's owner has used it on testnet: <TxAnchor hash={demo.emergencyRevoke.hash} />
              </>
            ) : null}
            . A grant also ends by itself at its expiry or when its budget is spent. Stopping the MCP server process ends the session; nothing keeps running.
          </p>
        </OnboardStep>
      </ol>
      {onboarding.judgeDemo.present ? (
        <p className="border-t border-line p-5 text-xs text-faint sm:px-6">
          Reviewers: the reproducible path with fresh grants is the{" "}
          <a href="#judge-steps" className="text-fg underline underline-offset-4">
            judge campaign walkthrough
          </a>{" "}
          below, taken from <Mono>{onboarding.judgeDemo.file}</Mono>. It uses its own small server (<Mono>services/judge-connect</Mono>, four tools) rather than the two servers described above.
        </p>
      ) : null}
    </Card>
  );
}

/* ---------- the reviewer walkthrough (docs/JUDGE_DEMO.md) ---------- */
type Role = "none" | "signer" | "owner" | "coordinator";
const ROLE_LABEL: Record<Role, string> = { none: "No key needed", signer: "Signer host · operator key", owner: "Owner shell · owner key", coordinator: "Coordinator · deployer environment" };
/**
 * Who runs each command of a step, in order, and one line of context. Written from the guide's own text; a note is
 * shown only while the step's heading still matches, so a reordered guide loses the notes rather than mislabelling.
 */
const JUDGE_STEP_NOTES: Array<{ n: number; heading: RegExp; roles: Role[]; note: string }> = [
  { n: 1, heading: /Create market A in Studio/, roles: ["coordinator", "coordinator"], note: "Optional for the prepared campaign, which already has its markets A and B. For a new campaign the coordinator funds a fresh judge address, the judge creates market A in Studio with that wallet, and the coordinator completes the kit from the creation transaction." },
  { n: 2, heading: /Connect an external MCP client/, roles: ["none", "signer", "none"], note: "Reads and simulated proposals need no signer. For a model-directed run the restricted server runs on the signer host with the operator key in its own environment; the model's process, started in a separate clean shell, is given only the socket path." },
  { n: 3, heading: /Run a permitted operation/, roles: ["signer"], note: "One repayment of up to 2 mUSD on the v1 account and one swap of 0.25 jWOKB on the v2 account, each inside its grant. Signed by the operator on the signer host, never by this app." },
  { n: 4, heading: /independent policy rejections/, roles: ["owner"], note: "Two owner borrows that are meant to fail: on market A the account policy rejects while the market policy allows, on market B the reverse. Both are mined reverts." },
  { n: 5, heading: /mined unauthorized operator action/, roles: ["signer"], note: "The operator tries a borrow it has no grant for. The server requires the OperatorNotAuthorized simulation first, then mines the revert." },
  { n: 6, heading: /Revoke all agent permissions/, roles: ["owner"], note: "The owner revokes every operator on all three accounts and clears the trigger. The second command only verifies and takes no signer." },
  { n: 7, heading: /Read activity/, roles: ["none"], note: "Refreshes the campaign's activity snapshot (the one shown above) once the demonstration has reached its confirmation depth." },
];

function JudgeWalkthrough() {
  const { file, steps } = RAW_CONFIG.onboarding.judgeDemo;
  if (!steps || steps.length === 0) return null;
  return (
    <Card as="section" id="judge-steps" className="scroll-mt-28" data-testid="connect-judge-steps" data-count={steps.length}>
      <CardHeader
        eyebrow="For reviewers"
        title="Reproduce the demonstration with the judge campaign"
        description={
          <>
            The steps and commands of <Mono>{file}</Mono>, in its order. Run them from a checkout of the repository; nothing here runs in this website, and no key is ever entered on this page. Read the guide itself for the preparation and for what each result file contains.
          </>
        }
      />
      <ol className="divide-y divide-line px-5 sm:px-6">
        {steps.map((entry) => {
          const notes = JUDGE_STEP_NOTES.find((candidate) => candidate.n === entry.n && candidate.heading.test(entry.title)) ?? null;
          return (
            <li key={entry.n} className="grid grid-cols-1 gap-x-5 gap-y-2 py-5 md:grid-cols-[2.5rem_minmax(0,1fr)]" data-judge-step={entry.n}>
              <span className="num grid size-8 place-items-center rounded-full bg-inverse text-sm font-medium text-on-inverse">{entry.n}</span>
              <div className="min-w-0 space-y-2.5">
                <h3 className="text-sm font-semibold">{entry.title}</h3>
                {notes ? <p className="text-sm text-muted">{notes.note}</p> : null}
                {entry.commands.map((command, index) => (
                  <div key={command} className="space-y-1.5" data-judge-command>
                    {notes?.roles[index] ? (
                      <Badge tone={notes.roles[index] === "none" ? "success" : "warning"} wrap>
                        {ROLE_LABEL[notes.roles[index]]}
                      </Badge>
                    ) : null}
                    <Code>{command}</Code>
                  </div>
                ))}
              </div>
            </li>
          );
        })}
      </ol>
      <p className="border-t border-line p-5 text-xs text-faint sm:px-6">
        Signed commands are run by the party that holds the corresponding key: the operator key on the signer host, the owner key in the owner's shell. This app holds neither and takes no part in them. Its role is to show the result: the two grants above are read live from the chain. The campaign's two v1 accounts also appear on Portfolio and Strategies for the owner's wallet; its v2 account belongs to the campaign's own v2 deployment and is shown on this page only.
      </p>
    </Card>
  );
}

/* ---------- the recorded run ---------- */

function StepRow({ n, title, tool, label, children }: { n: number; title: string; tool: string; label: string; children: ReactNode }) {
  return (
    <li className="grid gap-x-5 gap-y-2 py-4 grid-cols-1 md:grid-cols-[2.5rem_minmax(0,1fr)]" data-step={n}>
      <span className="num grid size-8 place-items-center rounded-full bg-raised text-sm font-medium">{n}</span>
      <div className="min-w-0 space-y-1.5">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <h3 className="text-sm font-medium">{title}</h3>
          <Badge tone="outline" wrap>
            {label}
          </Badge>
        </div>
        <p className="text-xs text-faint">
          <Mono>{tool}</Mono>
        </p>
        <div className="text-sm text-muted">{children}</div>
      </div>
    </li>
  );
}

function Transcript({ run }: { run: ConnectTranscript }) {
  const amount = (raw: bigint) => `${formatAmount(raw, run.debt.decimals)} ${run.debt.symbol}`;
  const txUrl = explorerTxUrl(run.chainId, run.step5.hash);
  const read = (block: { number: string }) => `Read at testnet block ${num(block.number)}`;
  return (
    <Card as="section" id="run" className="scroll-mt-28" data-testid="connect-run" data-hash={run.step5.hash}>
      <CardHeader
        eyebrow="Recorded · X Layer testnet (chain 1952)"
        title="The seven steps, run by an external MCP client"
        description={
          <>
            {run.transport}. One real public testnet transaction; every other step is a read or a simulation. Source: <Mono>{run.file}</Mono>.
          </>
        }
        action={<Badge tone="success">Scripted MCP client · verified</Badge>}
      />
      <ol className="divide-y divide-line px-5 sm:px-6">
        <StepRow n={1} title="Read the account and its positions" tool="sentinel_get_portfolio · sentinel_get_positions" label={read(run.step1.block)}>
          Account <Mono>{shortAddress(run.account)}</Mono>, owner <Mono>{shortAddress(run.owner)}</Mono>.{" "}
          {run.step1.collateral ? (
            <>
              Collateral supplied: <span className="num text-fg">{formatAmount(run.step1.collateral.suppliedRaw, run.step1.collateral.decimals)} {run.step1.collateral.symbol}</span>.{" "}
            </>
          ) : null}
          Debt: <span className="num text-fg">{amount(run.step1.debtStoredRaw)}</span>. Idle in the account: <span className="num text-fg">{amount(run.step1.idleDebtAssetRaw)}</span>.
        </StepRow>
        <StepRow n={2} title="Read the policies and the remaining authorisation" tool="sentinel_get_policies · sentinel_get_strategies" label={read(run.step2.grantBlock)}>
          {run.step2.policies.length} policies ({run.step2.policies.map((policy) => `${policy.layer}${policy.gateCount ? `, ${policy.gateCount} gates` : ""}`).join("; ")}). Operator <Mono>{shortAddress(run.operator)}</Mono>: {run.step2.grant.repayOnly ? "repay only" : `mask ${run.step2.grant.opMask}`}, budget left{" "}
          <span className="num text-fg">{amount(run.step2.grant.remainingRaw)}</span>, expires {utc(run.step2.grant.expiry)}, trigger at {formatBps(run.step2.grant.triggerBps)}.
        </StepRow>
        <StepRow n={3} title="Ask for a price quote" tool="sentinel_quote" label={run.step3.quote ? `OKX quote · chain ${run.step3.quote.chainId} · informational` : "Quote unavailable"}>
          <span data-testid="connect-quote" data-available={String(run.step3.quote !== null)}>
            {run.step3.quote ? (
              <>
                {run.step3.quote.source}, X Layer mainnet (chain {run.step3.quote.chainId}), observed {run.step3.quote.observedAt.slice(0, 19).replace("T", " ")} UTC:{" "}
                <span className="num text-fg">
                  {formatAmount(run.step3.quote.amountInRaw, run.step3.quote.tokenIn.decimals, { maxFractionDigits: 6 })} {run.step3.quote.tokenIn.symbol}
                </span>{" "}
                for{" "}
                <span className="num text-fg">
                  {formatAmount(run.step3.quote.amountOutRaw, run.step3.quote.tokenOut.decimals, { maxFractionDigits: 6 })} {run.step3.quote.tokenOut.symbol}
                </span>
                . A price indication at that moment. It is not the settlement price, and its calldata is never executed.
              </>
            ) : (
              <>
                <span className="font-medium text-fg">Quote unavailable.</span> {run.step3.provider} gave no quote in this run{run.step3.code ? ` (${run.step3.code}: the server had no provider credentials)` : ""}. No number is shown in its place, and no other source is substituted. The other steps do not depend on it.
              </>
            )}
          </span>
        </StepRow>
        <StepRow n={4} title="Simulate, then propose" tool="sentinel_simulate_auto_repay · sentinel_propose_auto_repay" label="Simulation · nothing sent">
          The contract simulation at block {num(run.step4.block.number)} said {run.step4.eligible ? "eligible" : "not eligible"}: repay <span className="num text-fg">{amount(run.step4.amountRaw)}</span>. The server recorded proposal <Mono>{shortHash(run.step4.proposalId)}</Mono>, valid for five minutes, calling <Mono>{run.step4.selector}</Mono> (autoRepay) with no value.
        </StepRow>
        <StepRow n={5} title="Execute the authorised operation" tool="sentinel_execute_auto_repay" label="Public testnet transaction">
          <span data-testid="connect-execute">
            Confirmed in block <span className="num text-fg">{num(run.step5.block.number)}</span>: repaid <span className="num text-fg">{amount(run.step5.amountRaw)}</span> from the account's own funds. Loan-to-value {formatBps(run.step5.ltvBeforeBps)} → {formatBps(run.step5.ltvAfterBps)}. Stored debt {amount(run.step5.debtBeforeRaw)} → {amount(run.step5.debtAfterRaw)}. Grant {amount(run.step5.grantBeforeRaw)} → {amount(run.step5.grantAfterRaw)}.
          </span>
          <span className="mt-1.5 block">
            {txUrl ? (
              <a href={txUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-mono text-[0.8125rem] break-all text-fg underline underline-offset-4" data-testid="connect-tx-link">
                {run.step5.hash} <IconArrowUpRight size={13} />
              </a>
            ) : (
              <Mono>{run.step5.hash}</Mono>
            )}
          </span>
          <span className="mt-1 block text-xs text-faint">
            Sent by the operator <Mono>{shortAddress(run.step5.from)}</Mono> to the account, value {run.step5.valueWei} wei, {num(run.step5.gasUsed)} gas.
          </span>
        </StepRow>
        <StepRow n={6} title="Try an operation the account does not allow" tool="sentinel_simulate_operator_borrow" label="Simulated rejection · not a mined revert">
          <span data-testid="connect-rejection" data-error={run.step6.error}>
            The operator asked to {run.step6.operation} {amount(run.step6.amountRaw)}, as a read-only {run.step6.method} of the account's real entrypoint at block {num(run.step6.block.number)}. The contract {run.step6.rejected ? "rejected it" : "did not reject it"}: <Mono>{run.step6.error}</Mono>. No transaction exists for this step.
          </span>
        </StepRow>
        <StepRow n={7} title="Read the transaction and the updated authorisation" tool="sentinel_get_execution_receipt · sentinel_get_strategies" label={read(run.step7.block)}>
          The receipt was read back from the chain ({run.step7.confirmations} confirmations at the time; this is L2 depth, not L1 finality). Budget left after the run: <span className="num text-fg">{amount(run.step7.grant.remainingRaw)}</span>.
        </StepRow>
      </ol>
      <p className="border-t border-line p-5 text-xs text-faint sm:px-6">
        Anyone can re-check this record without a key: <Mono>node services/mcp/verify-demo.mjs</Mono> replays the receipt and the balances against the public RPC.
      </p>
    </Card>
  );
}
