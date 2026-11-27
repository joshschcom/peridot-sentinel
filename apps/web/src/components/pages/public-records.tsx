"use client";
/**
 * Public testnet records that complement the live reads:
 *   MinedRejections   two MINED reverts (reverted transactions on chain), one per policy layer. Never mixed with
 *                     simulations: a simulation has no hash, a mined revert has a hash and no events.
 *   ActivitySnapshot  the contracts team's indexed event snapshot, shown as HISTORICAL data with its block range.
 *                     Its last block hash is re-read from the chain before it is called canonical, and the blocks
 *                     after it are disclosed as not covered by it.
 *   V2Portfolio       positions of the connected wallet's Sentinel v2 account, if it has one.
 */
import { useQuery } from "@tanstack/react-query";
import { Badge, Card, CardHeader, Mono, Notice } from "@/components/ui/core";
import { IconAlert, IconArrowUpRight } from "@/components/ui/icons";
import { useWallet } from "@/hooks/use-wallet";
import { formatAmount, formatBps } from "@/lib/amount";
import { LOG_MAX_PAGES, LOG_PAGE_BLOCKS, explorerTxUrl, xLayerTestnet } from "@/lib/chains";
import { SEGMENT_SOURCE_TEXT, coverageCheckpoint, gapReasonText } from "@/lib/activity-coverage";
import { EXPANSION } from "@/lib/expansion";
import { shortAddress, shortHash } from "@/lib/format";
import { TARGET_KIND, TARGET_LABEL } from "@/lib/chains";
import { VAULT_UI_ON } from "@/lib/strategy-context";
import { readV2Account, v2AccountOf, verifySnapshotTerminal } from "@/services/chain/expansion";
import { V2_OWNER_TARGET, readOwnerV2 } from "@/services/chain/v2-owner";
import type { Address } from "@/services/types";
import { V2_READS_ON } from "./trade";

const num = (value: bigint | number) => Number(value).toLocaleString("en-US");
const TxLink = ({ hash }: { hash: string }) => {
  const url = explorerTxUrl(xLayerTestnet.id, hash);
  return url ? (
    <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-mono text-[0.8125rem] break-all text-fg underline underline-offset-4">
      {shortHash(hash, 14, 10)} <IconArrowUpRight size={13} />
    </a>
  ) : (
    <Mono>{hash}</Mono>
  );
};

export function MinedRejections() {
  if (EXPANSION.minedRejections.status !== "ok") return null;
  const { rejections, file } = EXPANSION.minedRejections.value;
  return (
    <Card as="section" id="mined-rejections" className="scroll-mt-28" data-testid="mined-rejections">
      <CardHeader
        eyebrow="Recorded · X Layer testnet (chain 1952)"
        title="Two independent rejections, mined"
        description="Two real transactions that reverted on the public testnet. In each, one policy layer said no while the other said yes, so the two layers are shown to decide independently."
        action={<Badge tone="danger">Mined reverts</Badge>}
      />
      <ul className="divide-y divide-line px-5 text-sm sm:px-6">
        {rejections.map((row) => {
          const byAccount = row.error === "AccountPolicyRejected";
          return (
            <li key={row.hash} className="space-y-1.5 py-4" data-mined-rejection={row.error} data-hash={row.hash}>
              <p className="font-medium">{byAccount ? "Stopped by the account's own policy, while the market's policy allowed it" : "Stopped by the market's policy, while the account's own policy allowed it"}</p>
              <p className="text-muted">
                A borrow that would put the loan-to-value at {formatBps(row.postLtvBps)} reverted with <Mono>{row.error}</Mono> in block {num(row.block)}. Market circuit answered <Mono>{row.marketOutput}</Mono>, account circuit <Mono>{row.accountOutput}</Mono> (01 allow, 00 deny).{row.debtUnchanged ? " The debt recorded for the account is unchanged." : ""} Account <Mono>{shortAddress(row.account)}</Mono>, market {row.market}.
              </p>
              <TxLink hash={row.hash} />
            </li>
          );
        })}
      </ul>
      <p className="border-t border-line p-5 text-xs text-faint sm:px-6">
        A reverted transaction has a hash and a failed receipt, and leaves no events. The error was decoded by replaying the same call at the parent block and at the mined block. This is different from a simulation in this app, which sends nothing and is always labelled “Simulation”. Policy circuits on testnet run on the development reference processor, not TapeOut. Source: <Mono>{file}</Mono>.
      </p>
    </Card>
  );
}

/** Events worth a line of their own. Everything else is counted, not listed. */
const NOTABLE: Record<string, string> = {
  MarketCreated: "Market created",
  AccountCreated: "Sentinel account created",
  OperatorSet: "Operator authorised (v1)",
  GrantSet: "Operator grant set (v2)",
  AutoRepayExecuted: "Auto-repay executed by an operator",
  SwapSettled: "Swap settled (v2, mock venue)",
  VaultSettled: "Vault operation settled (mock vault)",
};

export function ActivitySnapshot() {
  const snapshot = EXPANSION.snapshot.status === "ok" ? EXPANSION.snapshot.value : null;
  const terminal = useQuery({ queryKey: ["snapshot-terminal", snapshot?.toBlockHash], queryFn: () => verifySnapshotTerminal(snapshot!.toBlock, snapshot!.toBlockHash), enabled: snapshot !== null && V2_READS_ON, staleTime: 60_000, retry: 1 });
  if (!snapshot) return null;
  const notable = snapshot.events.filter((event) => NOTABLE[event.eventName]);
  const { segments, gaps } = snapshot.coverage;
  const transactions = new Set(snapshot.events.map((event) => event.transactionHash)).size;
  // The contracts team's helper decides: the observed hash at the checkpoint, or null when it could not be read.
  const checkpoint = !V2_READS_ON || terminal.isPending ? null : coverageCheckpoint(snapshot.coverage, terminal.data ? terminal.data.hash : null).checkpoint;
  const state = !V2_READS_ON ? "unchecked" : checkpoint === null ? "checking" : checkpoint === "matches" ? "canonical" : checkpoint === "conflict" ? "not-canonical" : "unchecked";
  // Blocks newer than the snapshot: the live scan on this page reads the most recent pages; anything older is a gap.
  const liveTailFrom = terminal.data ? terminal.data.head - LOG_PAGE_BLOCKS * BigInt(LOG_MAX_PAGES) + 1n : null;
  const gap = terminal.data && liveTailFrom !== null && liveTailFrom > snapshot.toBlock + 1n ? { from: snapshot.toBlock + 1n, to: liveTailFrom - 1n } : null;
  return (
    <Card as="section" id="snapshot" className="scroll-mt-28" data-testid="activity-snapshot" data-state={state} data-from={snapshot.fromBlock.toString()} data-to={snapshot.toBlock.toString()} data-events={snapshot.events.length}>
      <CardHeader
        eyebrow="Historical snapshot · X Layer testnet (chain 1952)"
        title={segments.length === 1 ? `Indexed events, blocks ${num(snapshot.fromBlock)} to ${num(snapshot.toBlock)}` : `Indexed events in ${segments.length} checked segments`}
        description="A snapshot of settled on-chain events built by an off-line indexer and shipped with this build. It fills the block range a browser cannot scan. It is history, not a live feed. The entries of your own wallet and accounts are merged into the list above when the snapshot's checkpoint matches the chain; this card shows the snapshot as a whole."
        action={<Badge tone={state === "canonical" ? "success" : state === "not-canonical" ? "danger" : "outline"}>{state === "canonical" ? "Range end verified" : state === "not-canonical" ? "Checkpoint conflict" : state === "checking" ? "Checking…" : "Not checked"}</Badge>}
      />
      <div className="space-y-4 p-5 text-sm sm:p-6">
        {/* The events are previously verified evidence in every state: they stay listed with their original hashes. */}
        {state === "not-canonical" ? (
          <Notice tone="danger" icon={<IconAlert size={18} />} title="The chain's block at the snapshot's checkpoint is not the block the snapshot recorded" data-testid="snapshot-conflict">
            The events below are shown as previously verified evidence, with their original transaction hashes. They are not merged into the live list above, and this page does not claim that the chain it reads now contains them.
          </Notice>
        ) : state === "unchecked" && V2_READS_ON ? (
          <p className="text-muted" data-testid="snapshot-unchecked">The snapshot&apos;s checkpoint could not be compared with the chain just now. The events below are previously verified evidence with their original transaction hashes; they are not merged into the live list above until the checkpoint has been read.</p>
        ) : null}
        <>
          <>
            <p className="text-muted" data-testid="snapshot-coverage">
              {num(snapshot.events.length)} events in {num(transactions)} transactions, in {segments.length === 1 ? "one checked segment" : `${segments.length} checked segments that are not one continuous range`}, refreshed {snapshot.updatedAt.slice(0, 16).replace("T", " ")} UTC.{" "}
              {state === "canonical" ? "The hash of its last block was just re-read from the chain and matches." : state === "checking" ? "Its last block is being checked against the chain." : state === "not-canonical" ? "" : "Its last block could not be checked against the chain from this page."}{" "}
              {terminal.data ? (
                gap ? (
                  <span data-testid="snapshot-gap" data-gap={(gap.to - gap.from + 1n).toString()}>
                    Blocks {num(gap.from)} to {num(gap.to)} ({num(gap.to - gap.from + 1n)} blocks) are newer than the snapshot and older than the live scan on this page: events in them are not shown anywhere here until the snapshot is refreshed.
                  </span>
                ) : (
                  <span data-testid="snapshot-gap" data-gap="0">The live scan on this page starts before the snapshot ends, so no block is left unread between them.</span>
                )
              ) : null}
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <h3 className="text-[0.8125rem] font-medium">Checked segments</h3>
                <ul className="mt-1.5 space-y-1.5 text-[0.8125rem] text-muted" data-testid="snapshot-segments" data-segments={segments.length}>
                  {segments.map((segment) => (
                    <li key={segment.from.toString()} data-segment={`${segment.from}-${segment.to}`} data-source-coverage={segment.sourceCoverage}>
                      <span className="num text-fg">
                        Blocks {num(segment.from)} to {num(segment.to)}
                      </span>
                      : {SEGMENT_SOURCE_TEXT[segment.sourceCoverage]}. Ends at block hash <Mono>{shortHash(segment.toBlockHash)}</Mono>
                      {segment.fromBlockHash ? (
                        <>
                          , re-anchored at <Mono>{shortHash(segment.fromBlockHash)}</Mono>
                        </>
                      ) : null}
                      .
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <h3 className="text-[0.8125rem] font-medium">Gaps the snapshot states</h3>
                <ul className="mt-1.5 space-y-1.5 text-[0.8125rem] text-muted" data-testid="snapshot-gaps" data-gaps={gaps.length}>
                  {gaps.length === 0 ? <li>None.</li> : null}
                  {gaps.map((entry) => (
                    <li key={entry.from.toString()} data-stated-gap={`${entry.from}-${entry.to}`} data-reason={entry.permanent ? "history-unavailable" : "other"}>
                      <span className={entry.permanent ? "num text-danger" : "num text-fg"}>
                        Blocks {num(entry.from)} to {num(entry.to)}
                      </span>{" "}
                      ({num(entry.to - entry.from + 1n)} blocks): {gapReasonText(entry.reason, snapshot.confirmations)}.
                    </li>
                  ))}
                </ul>
              </div>
            </div>
            <ul className="divide-y divide-line rounded-control border border-line">
              {notable.map((event) => (
                <li key={`${event.transactionHash}-${event.logIndex}`} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-3.5 py-2.5" data-snapshot-event={event.eventName} data-hash={event.transactionHash}>
                  <span>
                    {NOTABLE[event.eventName]} <span className="num text-faint">· block {num(event.blockNumber)} · {event.contract}</span>
                  </span>
                  <TxLink hash={event.transactionHash} />
                </li>
              ))}
            </ul>
            <details className="rounded-control border border-line" data-testid="snapshot-all-events">
              <summary className="flex min-h-11 items-center px-3.5 text-sm font-medium text-muted hover:text-fg">Every event in the snapshot ({num(snapshot.events.length)}), with its original transaction hash</summary>
              <ul className="max-h-96 divide-y divide-line overflow-auto border-t border-line text-[0.8125rem]">
                {snapshot.events.map((event) => (
                  <li key={`${event.transactionHash}-${event.logIndex}`} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 px-3.5 py-2" data-recorded-event={event.eventName} data-hash={event.transactionHash}>
                    <span className="min-w-0 break-words">
                      {event.eventName} <span className="num text-faint">· block {num(event.blockNumber)} · {event.contract}</span>
                    </span>
                    <Mono className="break-all text-faint">{event.transactionHash}</Mono>
                  </li>
                ))}
              </ul>
            </details>
            <p className="text-xs text-faint">
              {num(snapshot.events.length - notable.length)} further events (interest accrual, transfers, price updates, registrations) are in the snapshot file and listed only in the full list above. Reverted transactions emit no events, so they are never in a snapshot: see the mined rejections. Off-chain keeper reports are a separate source and are not part of it. Source: <Mono>{snapshot.file}</Mono>.
            </p>
          </>
        </>
      </div>
    </Card>
  );
}

/**
 * The connected wallet's own v2 accounts through the build's owner target (`accountOf(wallet)` at each factory):
 * the base account on the local chain, and the vault account wherever the vault is offered. Same read as Trade.
 */
function OwnerV2Portfolio({ base }: { base: boolean }) {
  const wallet = useWallet();
  const target = V2_OWNER_TARGET;
  const owner = target && wallet.status === "connected" && wallet.chainId === target.chainId ? (wallet.address as Address) : null;
  const state = useQuery({ queryKey: ["v2-owner", target?.chainId, owner], queryFn: () => readOwnerV2(target!, owner!), enabled: target !== null && owner !== null, staleTime: 15_000, retry: 1 });
  if (!target || !owner) return null;
  const data = state.data;
  const account = base ? (data?.base ?? null) : null;
  const vault = target.vault ? (data?.vault ?? null) : null;
  const { wokb, usdc } = target.tokens;
  const shown = (base ? 1 : 0) + (target.vault ? 1 : 0);
  if (shown === 0) return null;
  return (
    <div className="border-t border-line px-5 py-4 text-sm sm:px-6" data-testid="portfolio-v2-owner" data-state={state.isPending ? "loading" : state.isError ? "error" : account || vault ? "account" : "none"} data-account={account?.account ?? ""} data-vault-account={vault?.account ?? ""}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-medium">{base ? "Sentinel v2 accounts" : "Sentinel v2 vault account"}</h3>
        <Badge tone="outline" wrap>
          {TARGET_LABEL} · mock tokens{base ? ", venue" : ""}
          {target.vault ? " and vault" : ""}
        </Badge>
      </div>
      {state.isPending ? (
        <p className="mt-2 text-muted">Reading…</p>
      ) : state.isError ? (
        <p className="mt-2 text-danger">Your v2 accounts could not be read. Nothing is shown in their place.</p>
      ) : !account && !vault ? (
        <p className="mt-2 text-muted">{base ? "This wallet has no Sentinel v2 account on this chain." : "This wallet has no vault account."} One can be created on <a href="/trade" className="underline underline-offset-4">Trade</a>.</p>
      ) : (
        <table className="num mt-3 w-full text-left">
          <tbody className="divide-y divide-line">
            {account ? (
              <>
                <tr data-portfolio-row="v2-idle">
                  <th scope="row" className="py-2 pr-3 font-normal text-muted">Idle tokens in the v2 account</th>
                  <td className="py-2 text-right">
                    {formatAmount(account.idleWokb, wokb.decimals)} {wokb.symbol} · {formatAmount(account.idleUsdc, usdc.decimals)} {usdc.symbol}
                    {data?.collateral && account.idleCollateral !== null ? ` · ${formatAmount(account.idleCollateral, data.collateral.decimals)} ${data.collateral.symbol}` : ""}
                  </td>
                </tr>
                <tr data-portfolio-row="v2-lending">
                  <th scope="row" className="py-2 pr-3 font-normal text-muted">Peridot lending, through the v2 lending adapter</th>
                  <td className="py-2 text-right">
                    collateral shares {account.collateralShares.toString()} · debt {account.debtRaw.toString()} (raw units)
                  </td>
                </tr>
                <tr data-portfolio-row="v2-operators">
                  <th scope="row" className="py-2 pr-3 font-normal text-muted">Operators listed by the account</th>
                  <td className="py-2 text-right">{account.operators.length === 0 ? "None" : account.operators.map((operator) => shortAddress(operator)).join(", ")}</td>
                </tr>
              </>
            ) : base ? (
              <tr data-portfolio-row="v2-none">
                <th scope="row" className="py-2 pr-3 font-normal text-muted">Sentinel v2 account</th>
                <td className="py-2 text-right text-muted">None on this chain</td>
              </tr>
            ) : null}
            {target.vault ? (
              vault ? (
                <tr data-portfolio-row="v2-vault" data-shares={vault.shares.toString()} data-idle={vault.idleAsset.toString()}>
                  <th scope="row" className="py-2 pr-3 font-normal text-muted">Vault account (mock ERC-4626 vault, no yield)</th>
                  <td className="py-2 text-right">
                    {formatAmount(vault.shares, target.vault.shareDecimals)} shares, a claim on {formatAmount(vault.claimAssets, target.vault.asset.decimals)} {target.vault.asset.symbol} · idle {formatAmount(vault.idleAsset, target.vault.asset.decimals)} {target.vault.asset.symbol}
                  </td>
                </tr>
              ) : (
                <tr data-portfolio-row="v2-vault-none">
                  <th scope="row" className="py-2 pr-3 font-normal text-muted">Vault account</th>
                  <td className="py-2 text-right text-muted">None</td>
                </tr>
              )
            ) : null}
          </tbody>
        </table>
      )}
      {account || vault ? (
        <p className="mt-2 text-xs text-faint">
          {account ? <>Account <Mono>{shortAddress(account.account)}</Mono>, read at block {num(account.block.number)}. </> : null}
          {vault ? <>Vault account <Mono>{shortAddress(vault.account)}</Mono>. </> : null}
          v2 accounts are separate from a v1 Sentinel account and from each other: none holds another's tokens, shares, debt or grants, and there is no combined health figure. Manage them on <a href="/trade" className="underline underline-offset-4">Trade</a>.
        </p>
      ) : null}
    </div>
  );
}

/** The connected wallet's Sentinel v2 account, when the build has a v2 manifest and the wallet owns one. */
export function V2Portfolio() {
  // The local chain has its own v2 deployment: both accounts come from the owner target.
  if (TARGET_KIND === "local") return <OwnerV2Portfolio base />;
  return (
    <>
      <TestnetV2Portfolio />
      {VAULT_UI_ON ? <OwnerV2Portfolio base={false} /> : null}
    </>
  );
}

function TestnetV2Portfolio() {
  const wallet = useWallet();
  const manifest = EXPANSION.manifest.status === "ok" ? EXPANSION.manifest.value : null;
  const owner = wallet.status === "connected" ? (wallet.address as Address) : null;
  const state = useQuery({
    queryKey: ["v2-portfolio", owner],
    queryFn: async () => {
      const account = await v2AccountOf(manifest!, owner!);
      return account ? readV2Account(manifest!, account) : null;
    },
    enabled: manifest !== null && owner !== null && V2_READS_ON,
    staleTime: 30_000,
    retry: 1,
  });
  if (!manifest || !V2_READS_ON || !owner) return null;
  const data = state.data;
  const { wokb, usdc } = manifest.tokens;
  return (
    <div className="border-t border-line px-5 py-4 text-sm sm:px-6" data-testid="portfolio-v2" data-state={state.isPending ? "loading" : state.isError ? "error" : data ? "account" : "none"} data-account={data?.account ?? ""}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-medium">Sentinel v2 account</h3>
        <Badge tone="outline">Testnet · mock tokens and venue</Badge>
      </div>
      {state.isPending ? (
        <p className="mt-2 text-muted">Reading…</p>
      ) : state.isError ? (
        <p className="mt-2 text-danger">Your v2 account could not be read from the public testnet RPC. Nothing is shown in its place.</p>
      ) : !data ? (
        <p className="mt-2 text-muted">This wallet has no Sentinel v2 account.</p>
      ) : (
        <table className="num mt-3 w-full text-left">
          <tbody className="divide-y divide-line">
            <tr data-portfolio-row="v2-idle">
              <th scope="row" className="py-2 pr-3 font-normal text-muted">Idle tokens in the account</th>
              <td className="py-2 text-right">
                {formatAmount(data.idleWokb, wokb.decimals)} {wokb.symbol} · {formatAmount(data.idleUsdc, usdc.decimals)} {usdc.symbol}
              </td>
            </tr>
            <tr data-portfolio-row="v2-lending">
              <th scope="row" className="py-2 pr-3 font-normal text-muted">Peridot lending, through the v2 lending adapter</th>
              <td className="py-2 text-right">
                collateral shares {data.collateralShares.toString()} · debt {data.debtRaw.toString()} (raw units)
              </td>
            </tr>
            <tr data-portfolio-row="v2-operators">
              <th scope="row" className="py-2 pr-3 font-normal text-muted">Operators listed by the account</th>
              <td className="py-2 text-right">{data.operators.length === 0 ? "None" : data.operators.map((operator) => shortAddress(operator)).join(", ")}</td>
            </tr>
          </tbody>
        </table>
      )}
      {data ? (
        <p className="mt-2 text-xs text-faint">
          Account <Mono>{shortAddress(data.account)}</Mono>, read at block {num(data.block.number)}. A v2 account is separate from a v1 Sentinel account: neither holds the other's shares, debt or grants. There is no combined health figure across them. Swaps are on the <a href="/trade" className="underline underline-offset-4">Trade</a> page.
        </p>
      ) : null}
    </div>
  );
}
