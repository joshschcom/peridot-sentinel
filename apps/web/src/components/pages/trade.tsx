"use client";
/**
 * Trade: the Sentinel v2 swap path on X Layer testnet, READ-ONLY in this app.
 *
 * What is shown: an in-browser check that the v2 manifest is really deployed, the demo v2 account read at one block
 * (idle tokens, lending exposure, every operator and its swap grant), a read-only quote from the venue's mock price
 * source, and the recorded public receipts, each labelled by kind (owner action, operator execution, mined revert,
 * simulated rejection). What is not offered: any v2 transaction from this app.
 *
 * The venue on testnet is an inventory-backed MOCK. It is never called Uniswap here.
 */
import { useQuery } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";
import { Badge, Button, Card, CardHeader, DefinitionRow, EmptyState, Mono, Notice, PageHeader, Skeleton } from "@/components/ui/core";
import { IconAlert, IconArrowUpRight, IconCheck } from "@/components/ui/icons";
import { formatAmount, parseAmount } from "@/lib/amount";
import { TARGET_KIND, explorerAddressUrl, explorerTxUrl, xLayerTestnet } from "@/lib/chains";
import { V2_OWNER_TARGET, V2_OWNER_TARGET_REASON } from "@/services/chain/v2-owner";
import { V2OwnerFlows } from "./v2-owner";
import { EXPANSION, type ExpansionManifest, V2_OP_LABEL, V2_SCOPE_LABEL, V2_SWAP_LABEL, type V2Demo } from "@/lib/expansion";
import { shortAddress, shortHash } from "@/lib/format";
import { readV2Account, readVenueQuote, verifyV2Deployment } from "@/services/chain/expansion";
import { FORCE_FIXTURE } from "@/services/runtime";
import type { Address } from "@/services/types";

const num = (value: bigint | number) => Number(value).toLocaleString("en-US");
const utc = (seconds: bigint) => `${new Date(Number(seconds) * 1000).toISOString().slice(0, 16).replace("T", " ")} UTC`;
/** v2 reads exist for the public testnet only. */
export const V2_READS_ON = TARGET_KIND === "testnet" && !FORCE_FIXTURE;

/** The local development chain has its own v2 deployment with owner writes: a different page body, labelled local. */
function LocalTrade() {
  return (
    <div className="space-y-6" data-testid="trade" data-v2={V2_OWNER_TARGET ? "local" : "absent"}>
      <PageHeader
        eyebrow="Sentinel v2"
        title="Trade and vault"
        description="Your own Sentinel v2 accounts on the local development chain: create them, fund them with test tokens, supply collateral, grant a bounded swap to an operator, revoke everything, and use the vault with a stated bound on every action."
        actions={<Badge tone="warning" wrap>Local chain · mock venue and vault</Badge>}
      />
      {V2_OWNER_TARGET ? <V2OwnerFlows target={V2_OWNER_TARGET} /> : <EmptyState title="Sentinel v2 is not in this build">{V2_OWNER_TARGET_REASON ?? "This build has no local Sentinel v2 manifest."}</EmptyState>}
    </div>
  );
}

export function Trade() {
  if (TARGET_KIND === "local") return <LocalTrade />;
  return <TestnetTrade />;
}

function TestnetTrade() {
  const manifest = EXPANSION.manifest.status === "ok" ? EXPANSION.manifest.value : null;
  const ownerWrites = V2_OWNER_TARGET !== null && V2_OWNER_TARGET.writes && V2_READS_ON;
  const demo = EXPANSION.demo.status === "ok" ? EXPANSION.demo.value : null;
  return (
    <div className="space-y-6" data-testid="trade" data-v2={manifest ? "deployed" : "absent"}>
      <PageHeader
        eyebrow="Sentinel v2"
        title="Trade"
        description="A v2 Sentinel account can swap between two tokens through one pinned venue, with the route, the recipient and the approvals fixed by the contract. An operator can do it only inside a per-call limit, a total budget and an expiry, and only if the execution policy circuit allows the loss."
        actions={<Badge tone="warning" wrap>Testnet · mock venue · read-only here</Badge>}
      />
      <Notice tone="warning" icon={<IconAlert size={18} />} title={V2_SWAP_LABEL} data-testid="trade-label">
        {V2_SCOPE_LABEL}. The venue pays out of an inventory at a price set by its owner: it is not a market, and nothing here is a real price. The same swap path against the real Uniswap v3 pool was run on a private fork of X Layer mainnet only; no mainnet transaction exists.
      </Notice>
      {!manifest ? (
        <EmptyState title="Sentinel v2 is not in this build">{EXPANSION.manifest.status === "unavailable" ? EXPANSION.manifest.reason : null}</EmptyState>
      ) : !V2_READS_ON ? (
        <>
          <Notice title="Live reads are off">{TARGET_KIND === "local" ? "This build targets the local development chain. Sentinel v2 lives on X Layer testnet, so it is not read here." : "This build runs on example data and makes no chain reads."} The recorded public receipts below are unaffected.</Notice>
          {demo ? <Receipts manifest={manifest} demo={demo} /> : null}
        </>
      ) : (
        <Live manifest={manifest} demo={demo} />
      )}
      {ownerWrites && V2_OWNER_TARGET ? <V2OwnerFlows target={V2_OWNER_TARGET} /> : null}
      <Card as="section" data-testid="trade-not-yet" data-owner-writes={String(ownerWrites)}>
        <CardHeader title="Not in this app yet" />
        <ul className="list-disc space-y-1.5 p-5 pl-10 text-sm text-muted sm:p-6 sm:pl-11">
          {ownerWrites ? <li>Swapping from your own wallet here. An operator swaps inside a grant; the owner flows above create the account and the grant.</li> : <li>Creating a v2 account, granting an operator or swapping from your own wallet here. The contracts are deployed, and the deployment's own switch for this app is off on testnet, so it offers none. The exact grant transaction of the swap strategy can be reviewed on Strategies.</li>}
          {ownerWrites && V2_OWNER_TARGET?.vault ? null : <li>The ERC-4626 vault account. It is deployed on testnet with a mock vault, and is switched off for this app there.</li>}
          <li>Quotes from OKX Onchain OS. None is shown anywhere in this app until the provider answers; the figures on this page come from the testnet venue's mock price source.</li>
        </ul>
      </Card>
    </div>
  );
}

function Live({ manifest, demo }: { manifest: ExpansionManifest; demo: V2Demo | null }) {
  const owner = demo?.owner ?? null;
  const check = useQuery({ queryKey: ["v2-deployment", manifest.contracts.factory, owner], queryFn: () => verifyV2Deployment(manifest, owner as Address), enabled: owner !== null, staleTime: 120_000, retry: 1 });
  const verified = check.data?.ok === true;
  return (
    <>
      <Card as="section" data-testid="v2-deployment" data-state={owner === null ? "no-record" : check.isPending ? "loading" : check.isError ? "error" : verified ? "ok" : "mismatch"}>
        <CardHeader
          eyebrow="Live · X Layer testnet (chain 1952)"
          title="Deployment check"
          description="Before anything below is shown, this page compares the chain with the published v2 manifest."
          action={<Badge tone={verified ? "success" : check.isPending && owner ? "neutral" : "danger"}>{verified ? "Verified" : check.isPending && owner ? "Checking…" : "Not verified"}</Badge>}
        />
        <div className="p-5 text-sm sm:p-6">
          {owner === null ? (
            <p className="text-muted">The recorded receipts that name the demo account's owner are not in this build, so the factory mapping cannot be checked. No v2 data is shown.</p>
          ) : check.isPending ? (
            <Skeleton className="h-16" data-loading />
          ) : check.isError || !check.data ? (
            <Notice tone="danger" icon={<IconAlert size={18} />} title="The deployment could not be checked">
              {check.error instanceof Error ? check.error.message.split("\n")[0] : "The public testnet RPC did not answer."} No v2 data is shown.
              <Button size="sm" variant="secondary" className="mt-3" onClick={() => void check.refetch()}>
                Try again
              </Button>
            </Notice>
          ) : verified ? (
            <p className="text-muted">
              <IconCheck size={16} className="mr-1 inline text-success" />
              At block <span className="num text-fg">{num(check.data.block.number)}</span>: the code at all {check.data.contracts} manifest addresses hashes to the recorded runtime code; the v2 factory maps the owner <Mono>{shortAddress(owner)}</Mono> to the demo account; the account is pinned to the manifest's swap adapter, lending adapter, execution policy, lending market and token pair. Source: <Mono>{manifest.file}</Mono>.
            </p>
          ) : (
            <Notice tone="danger" icon={<IconAlert size={18} />} title="The chain does not match the v2 manifest">
              <ul className="list-disc pl-5">
                {check.data.problems.map((problem) => (
                  <li key={problem}>{problem}</li>
                ))}
              </ul>
              No v2 data is shown.
            </Notice>
          )}
        </div>
      </Card>
      {verified ? (
        <>
          <DemoAccount manifest={manifest} />
          <VenueQuote manifest={manifest} />
        </>
      ) : null}
      {demo ? <Receipts manifest={manifest} demo={demo} /> : null}
    </>
  );
}

function DemoAccount({ manifest }: { manifest: ExpansionManifest }) {
  const account = manifest.contracts.account;
  const state = useQuery({ queryKey: ["v2-account", account], queryFn: () => readV2Account(manifest, account), staleTime: 30_000, retry: 1 });
  const data = state.data;
  const { wokb, usdc } = manifest.tokens;
  const token = (address: string) => (address.toLowerCase() === wokb.address.toLowerCase() ? wokb : usdc);
  const url = explorerAddressUrl(xLayerTestnet.id, account);
  return (
    <Card as="section" data-testid="v2-account" data-state={state.isPending ? "loading" : state.isError ? "error" : "ok"} data-block={data ? data.block.number.toString() : ""} data-usdc={data ? data.idleUsdc.toString() : ""} data-wokb={data ? data.idleWokb.toString() : ""} data-operators={data ? data.operators.length : ""}>
      <CardHeader eyebrow="Live · demo v2 account" title="What the account holds and whom it authorises" description="The demonstration account of the testnet deployment. It is not yours; it is read here so the swap path can be seen on real state." action={<Badge tone="outline">Read-only</Badge>} />
      {state.isPending ? (
        <Skeleton className="m-5 h-40" data-loading />
      ) : state.isError || !data ? (
        <div className="p-5 sm:p-6">
          <Notice tone="danger" icon={<IconAlert size={18} />} title="The account could not be read">
            {state.error instanceof Error ? state.error.message.split("\n")[0] : "The public testnet RPC did not answer."} Nothing is shown in its place.
          </Notice>
        </div>
      ) : (
        <div className="space-y-4 p-5 sm:p-6">
          <dl className="divide-y divide-line">
            <DefinitionRow stack label="Account" mono>
              {url ? (
                <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 break-all underline underline-offset-4">
                  {account} <IconArrowUpRight size={13} />
                </a>
              ) : (
                account
              )}
            </DefinitionRow>
            <DefinitionRow stack label="Owner" mono>
              {shortAddress(data.owner)}
            </DefinitionRow>
            <DefinitionRow stack label="Idle tokens (mock)">
              <span data-testid="v2-idle">
                {formatAmount(data.idleWokb, wokb.decimals)} {wokb.symbol} · {formatAmount(data.idleUsdc, usdc.decimals)} {usdc.symbol}
              </span>
            </DefinitionRow>
            <DefinitionRow stack label="Peridot lending (through the lending adapter)">
              <span data-testid="v2-exposure">
                collateral shares {data.collateralShares.toString()} · debt {data.debtRaw.toString()} (raw units, as the account reports them)
              </span>
            </DefinitionRow>
            <DefinitionRow stack label="Read at block">
              <span className="num">{num(data.block.number)}</span> · {utc(data.block.timestamp)}
            </DefinitionRow>
          </dl>
          <div>
            <h3 className="text-sm font-medium">Operators ({data.operators.length}, listed by the account itself)</h3>
            {data.operators.length === 0 ? (
              <p className="mt-1 text-sm text-muted">The account lists no operator.</p>
            ) : (
              <ul className="mt-2 divide-y divide-line rounded-control border border-line text-sm">
                {data.operators.map((operator) => {
                  const grants = data.swapGrants.filter((grant) => grant.operator.toLowerCase() === operator.toLowerCase());
                  return (
                    <li key={operator} className="px-3.5 py-2.5" data-v2-operator={operator}>
                      <Mono>{operator}</Mono>
                      {grants.length === 0 ? (
                        <span className="block text-muted">No swap grant.</span>
                      ) : (
                        grants.map((grant) => (
                          <span key={grant.inputAsset} className="num block text-muted" data-v2-grant={grant.inputAsset} data-remaining={grant.remaining.toString()}>
                            {V2_OP_LABEL[grant.op]} of {token(grant.inputAsset).symbol}: up to {formatAmount(grant.maxPerCall, token(grant.inputAsset).decimals)} per call, {formatAmount(grant.remaining, token(grant.inputAsset).decimals)} left in total, {grant.expired ? "expired" : "expires"} {utc(grant.expiry)}.
                          </span>
                        ))
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
            <p className="mt-2 text-xs text-faint">A v2 account enumerates its operators on chain, so this list is complete at that block. A spent or expired grant stays listed until the owner revokes it. An operator can never withdraw, and the swap output always goes to the account.</p>
          </div>
        </div>
      )}
    </Card>
  );
}

function VenueQuote({ manifest }: { manifest: ExpansionManifest }) {
  const { wokb, usdc } = manifest.tokens;
  const [text, setText] = useState("1");
  const parsed = parseAmount(text, wokb.decimals);
  const amountIn = parsed.ok && parsed.value > 0n ? parsed.value : null;
  const quote = useQuery({ queryKey: ["v2-quote", manifest.contracts.swap, amountIn?.toString()], queryFn: () => readVenueQuote(manifest, wokb.address, amountIn!), enabled: amountIn !== null, staleTime: 15_000, retry: 1 });
  const data = quote.data;
  // Loss allowed by a minimum output, exactly as the account computes it: ceil((expected - minOut) * 10000 / expected).
  const minOutAt = (lossBps: number) => (data ? data.expectedOut - (data.expectedOut * BigInt(lossBps)) / 10_000n : 0n);
  return (
    <Card as="section" data-testid="v2-quote" data-state={amountIn === null ? "bad-input" : quote.isPending ? "loading" : quote.isError ? "error" : "ok"} data-expected={data ? data.expectedOut.toString() : ""} data-block={data ? data.block.number.toString() : ""}>
      <CardHeader eyebrow="Live · read-only" title="What the testnet venue would expect" description="Ask the swap adapter what it expects for an exact input. This reads the venue's mock price source; it sends nothing and reserves nothing." action={<Badge tone="outline">Mock price · not an OKX quote</Badge>} />
      <div className="space-y-4 p-5 text-sm sm:p-6">
        <label className="block max-w-xs">
          Amount of {wokb.symbol} to swap
          <input inputMode="decimal" value={text} onChange={(event) => setText(event.target.value)} className="mt-1.5 h-11 w-full rounded-control border border-line-strong bg-bg px-3" data-testid="v2-quote-amount" />
        </label>
        {amountIn === null ? (
          <p className="text-warning">Enter a positive amount with at most {wokb.decimals} decimals. Nothing was read.</p>
        ) : quote.isPending ? (
          <Skeleton className="h-20" data-loading />
        ) : quote.isError || !data ? (
          <Notice tone="danger" icon={<IconAlert size={18} />} title="The venue gave no quote">
            {quote.error instanceof Error ? quote.error.message.split("\n")[0] : "The read failed."} No figure is shown in its place.
          </Notice>
        ) : (
          <dl className="divide-y divide-line">
            <DefinitionRow stack label="Expected output at the mock price">
              <span data-testid="v2-quote-expected">
                {formatAmount(data.expectedOut, usdc.decimals, { maxFractionDigits: 6 })} {usdc.symbol}
              </span>
            </DefinitionRow>
            <DefinitionRow stack label={`Lowest output the execution policy allows (${manifest.swap.policyMaxLossBps} bps loss)`}>
              {formatAmount(minOutAt(manifest.swap.policyMaxLossBps), usdc.decimals, { maxFractionDigits: 6 })} {usdc.symbol}
            </DefinitionRow>
            <DefinitionRow stack label={`Hard floor in the adapter (${manifest.swap.hardMaxLossBps} bps loss)`}>
              {formatAmount(data.floorOut, usdc.decimals, { maxFractionDigits: 6 })} {usdc.symbol}
            </DefinitionRow>
            <DefinitionRow stack label="Mock price set at">{utc(data.priceTime)}</DefinitionRow>
            <DefinitionRow stack label="Read at block">
              <span className="num">{num(data.block.number)}</span>
            </DefinitionRow>
          </dl>
        )}
        <p className="text-xs text-faint">Two separate limits apply to a swap. The adapter refuses a minimum output more than {manifest.swap.hardMaxLossBps} bps below this expectation, in Solidity. Inside that, the execution policy circuit allows at most {manifest.swap.policyMaxLossBps} bps: a 101 bps swap passes the hard floor and is still denied (see the mined revert below). The venue's fee is {manifest.swap.feePpm / 100} bps.</p>
      </div>
    </Card>
  );
}

function Row({ kind, label, tone, hash, children }: { kind: string; label: string; tone: "success" | "warning" | "outline" | "danger"; hash: string | null; children: ReactNode }) {
  const url = hash ? explorerTxUrl(xLayerTestnet.id, hash) : null;
  return (
    <li className="grid gap-x-4 gap-y-1.5 py-3.5 grid-cols-1 md:grid-cols-[minmax(0,1fr)_auto] md:items-start" data-receipt={kind} data-hash={hash ?? ""}>
      <div className="min-w-0 text-muted">
        {children}
        {hash ? (
          <span className="mt-1 block">
            {url ? (
              <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-mono text-[0.8125rem] break-all text-fg underline underline-offset-4">
                {shortHash(hash, 14, 10)} <IconArrowUpRight size={13} />
              </a>
            ) : (
              <Mono>{hash}</Mono>
            )}
          </span>
        ) : null}
      </div>
      <span>
        <Badge tone={tone} wrap>
          {label}
        </Badge>
      </span>
    </li>
  );
}

function Receipts({ manifest, demo }: { manifest: ExpansionManifest; demo: V2Demo }) {
  const { wokb, usdc } = manifest.tokens;
  const w = (raw: bigint) => `${formatAmount(raw, wokb.decimals)} ${wokb.symbol}`;
  const u = (raw: bigint) => `${formatAmount(raw, usdc.decimals, { maxFractionDigits: 6 })} ${usdc.symbol}`;
  return (
    <Card as="section" id="receipts" className="scroll-mt-28" data-testid="v2-receipts">
      <CardHeader eyebrow="Recorded · X Layer testnet (chain 1952)" title="Public receipts, by kind" description={<>Real public testnet transactions of the demo account, from <Mono>{demo.file}</Mono> and the v2 manifest. Each row says who sent it and what kind of evidence it is.</>} />
      <ul className="divide-y divide-line px-5 pb-2 text-sm sm:px-6">
        {demo.operatorSwap ? (
          <Row kind="operator-swap" label="Operator execution · mock venue" tone="success" hash={demo.operatorSwap.hash}>
            The operator <Mono>{shortAddress(demo.operator)}</Mono> swapped <span className="num text-fg">{w(demo.operatorSwap.amountIn)}</span> for <span className="num text-fg">{u(demo.operatorSwap.amountOut)}</span> under a swap-only grant, block {num(demo.operatorSwap.block)}. The output was paid to the account, not to the operator. Grant left afterwards: {w(demo.operatorSwap.remaining)}.
          </Row>
        ) : null}
        {demo.minedDenial ? (
          <Row kind="mined-denial" label="Mined revert" tone="danger" hash={demo.minedDenial.hash}>
            A swap that would accept a {demo.minedDenial.lossBps} bps loss was sent by the account's owner and reverted on chain with <Mono>{demo.minedDenial.error}</Mono>, block {num(demo.minedDenial.block)}: the execution policy allows at most {demo.minedDenial.policyMaxBps} bps. A reverted transaction: it has a hash and no events.
          </Row>
        ) : null}
        {manifest.simulatedDenial ? (
          <Row kind="simulated-denial" label="Simulated rejection · nothing sent" tone="outline" hash={null}>
            The same {manifest.simulatedDenial.lossBps} bps denial as a read-only eth_call at block {num(manifest.simulatedDenial.block)} (revert selector <Mono>{manifest.simulatedDenial.selector}</Mono>). A simulation: no transaction exists for it.
          </Row>
        ) : null}
        {demo.emergencyRevoke ? (
          <Row kind="emergency-revoke" label="Owner action · emergency stop" tone="warning" hash={demo.emergencyRevoke.hash}>
            The owner revoked every operator at once (<Mono>revokeAllOperators</Mono>), block {num(demo.emergencyRevoke.block)}. Afterwards the account listed {demo.emergencyRevoke.operatorCountAfter.toString()} operators. The live card above reads the current list from the chain: an operator appears there again only if the owner grants a new one.
          </Row>
        ) : null}
        {demo.grant ? (
          <Row kind="owner-grant" label="Owner action" tone="outline" hash={demo.grant.hash}>
            The owner granted the operator {V2_OP_LABEL[demo.grant.op] ?? `operation ${demo.grant.op}`}: {w(demo.grant.maxPerCall)} per call, {w(demo.grant.cumulative)} in total, until {utc(demo.grant.expiry)}.
          </Row>
        ) : null}
        {demo.ownerSupply ? (
          <Row kind="owner-supply" label="Owner action" tone="outline" hash={demo.ownerSupply.hash}>
            The owner supplied collateral to the Peridot lending market through the v2 account's lending adapter, block {num(demo.ownerSupply.block)}.
          </Row>
        ) : null}
        {manifest.ownerSetupSwap ? (
          <Row kind="owner-setup-swap" label="Owner action · not operator execution" tone="outline" hash={manifest.ownerSetupSwap.hash}>
            Deployment setup: the owner swapped {w(manifest.ownerSetupSwap.amountIn)} for {u(manifest.ownerSetupSwap.amountOut)} on the mock venue, block {num(manifest.ownerSetupSwap.block)}.
          </Row>
        ) : null}
      </ul>
    </Card>
  );
}
