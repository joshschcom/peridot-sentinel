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
import { type ReactNode } from "react";
import { Badge, Button, ButtonLink, Card, CardHeader, DefinitionRow, Mono, Notice, PageHeader, Skeleton } from "@/components/ui/core";
import { IconAlert, IconArrowUpRight, IconCheck, IconX } from "@/components/ui/icons";
import { formatAmount, formatBps } from "@/lib/amount";
import { TARGET_KIND, explorerAddressUrl, explorerTxUrl, xLayerTestnet } from "@/lib/chains";
import { CONNECT, CONNECT_EXECUTE_ENV, CONNECT_SCOPE_LABEL, CONNECT_SETUP_COMMANDS, CONNECT_STATUS_LABEL, CONNECT_STDIO_COMMAND, type ConnectToolKind, type ConnectTranscript, LLM_SESSION_LABEL, LLM_SESSION_SCOPE, type LlmSession, connectVerified, grantReadiness } from "@/lib/connect";
import { shortAddress, shortHash } from "@/lib/format";
import { Op } from "@/lib/policy";
import { readConnectGrant } from "@/services/chain/connect";
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
      <HowToConnect />
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
            <ButtonLink href="/automate" size="sm" variant="secondary">
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
            As announced by the server <Mono>{server}</Mono> {version} to an external MCP client over stdio. Recorded in <Mono>{CONNECT.toolsFile}</Mono>.
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

/* ---------- how to connect ---------- */

function Code({ children, testid }: { children: string; testid?: string }) {
  return (
    <pre className="overflow-x-auto rounded-control border border-line bg-subtle p-3.5 font-mono text-[0.8125rem] leading-relaxed" data-testid={testid}>
      {children}
    </pre>
  );
}

function HowToConnect() {
  const hostConfig = JSON.stringify({ mcpServers: { "sentinel-connect": { command: "node", args: [CONNECT_STDIO_COMMAND.replace(/^node /, "")] } } }, null, 2);
  return (
    <Card as="section" id="how" className="scroll-mt-28" data-testid="connect-how">
      <CardHeader title="Connect an MCP client" description="The server runs on your machine and talks to its host over stdio. It opens no port, and this website is not part of the connection." />
      <div className="space-y-5 p-5 text-sm sm:p-6">
        <div>
          <h3 className="font-medium">1. Prepare a checkout (Node 22.13 or later)</h3>
          <div className="mt-2">
            <Code>{CONNECT_SETUP_COMMANDS.join("\n")}</Code>
          </div>
          <p className="mt-2 text-xs text-faint">The last line starts the server in a separate process and lists its tools. It needs no key.</p>
        </div>
        <div>
          <h3 className="font-medium">2. Give your MCP host this stdio command</h3>
          <div className="mt-2">
            <Code testid="connect-command">{CONNECT_STDIO_COMMAND}</Code>
          </div>
          <p className="mt-2 text-muted">For hosts that take a JSON configuration:</p>
          <div className="mt-2">
            <Code>{hostConfig}</Code>
          </div>
          <p className="mt-2 text-xs text-faint">Started like this, the server has no key. Every read, quote and simulate tool works, and the execute tool answers EXECUTION_DISABLED.</p>
        </div>
        <div>
          <h3 className="font-medium">3. Execution is off until the host enables it</h3>
          <p className="mt-1 text-muted">The single signing tool works only when the host process itself carries both variables below, and only for a grant the account's owner has made to that operator.</p>
          <div className="mt-2">
            <Code>{CONNECT_EXECUTE_ENV.join("\n")}</Code>
          </div>
          <p className="mt-2 text-xs text-faint" data-testid="connect-key-note">
            The operator key stays in the MCP host's environment. It is never entered on this page: there is no field for it here, and the app never sees it. Give it only to a host you trust to use this one grant.
          </p>
        </div>
      </div>
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
