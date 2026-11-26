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
import { EXPANSION } from "@/lib/expansion";
import { shortAddress, shortHash } from "@/lib/format";
import { readV2Account, v2AccountOf, verifySnapshotTerminal } from "@/services/chain/expansion";
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
  const transactions = new Set(snapshot.events.map((event) => event.transactionHash)).size;
  const state = !V2_READS_ON ? "unchecked" : terminal.isPending ? "checking" : terminal.isError || !terminal.data ? "unchecked" : terminal.data.canonical ? "canonical" : "not-canonical";
  // Blocks newer than the snapshot: the live scan on this page reads the most recent pages; anything older is a gap.
  const liveTailFrom = terminal.data ? terminal.data.head - LOG_PAGE_BLOCKS * BigInt(LOG_MAX_PAGES) + 1n : null;
  const gap = terminal.data && liveTailFrom !== null && liveTailFrom > snapshot.toBlock + 1n ? { from: snapshot.toBlock + 1n, to: liveTailFrom - 1n } : null;
  return (
    <Card as="section" id="snapshot" className="scroll-mt-28" data-testid="activity-snapshot" data-state={state} data-from={snapshot.fromBlock.toString()} data-to={snapshot.toBlock.toString()} data-events={snapshot.events.length}>
      <CardHeader
        eyebrow="Historical snapshot · X Layer testnet (chain 1952)"
        title={`Indexed events, blocks ${num(snapshot.fromBlock)} to ${num(snapshot.toBlock)}`}
        description="A snapshot of settled on-chain events built by an off-line indexer and shipped with this build. It fills the block range a browser cannot scan. It is history, not a live feed."
        action={<Badge tone={state === "canonical" ? "success" : state === "not-canonical" ? "danger" : "outline"}>{state === "canonical" ? "Range end verified" : state === "not-canonical" ? "Not canonical" : state === "checking" ? "Checking…" : "Not checked"}</Badge>}
      />
      <div className="space-y-4 p-5 text-sm sm:p-6">
        {state === "not-canonical" ? (
          <Notice tone="danger" icon={<IconAlert size={18} />} title="The snapshot's last block is not the canonical block at that height">
            The chain no longer has the block this snapshot ends on, so its events are not shown.
          </Notice>
        ) : (
          <>
            <p className="text-muted" data-testid="snapshot-coverage">
              {num(snapshot.events.length)} events in {num(transactions)} transactions, every block from {num(snapshot.fromBlock)} to {num(snapshot.toBlock)} inclusive, refreshed {snapshot.updatedAt.slice(0, 16).replace("T", " ")} UTC.{" "}
              {state === "canonical" ? "The hash of its last block was just re-read from the chain and matches." : state === "checking" ? "Its last block is being checked against the chain." : "Its last block could not be checked against the chain from this page."}{" "}
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
            <p className="text-xs text-faint">
              {num(snapshot.events.length - notable.length)} further events (interest accrual, transfers, price updates, registrations) are in the snapshot file and not listed. Reverted transactions emit no events, so they are never in a snapshot: see the mined rejections. Off-chain keeper reports are a separate source and are not part of it. Source: <Mono>{snapshot.file}</Mono>.
            </p>
          </>
        )}
      </div>
    </Card>
  );
}

/** The connected wallet's Sentinel v2 account, when the build has a v2 manifest and the wallet owns one. */
export function V2Portfolio() {
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
