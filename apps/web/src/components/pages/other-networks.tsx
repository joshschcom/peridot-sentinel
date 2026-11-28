"use client";
/**
 * Portfolio, "Other networks · mainnet · read-only via OKX Onchain OS" (DECISIONS D25).
 *
 * What it is: the wallet tokens of ONE address per network on X Layer, Ethereum, Base and Solana MAINNET, as OKX
 * reports them through this app's own server route. It is a watch list. Nothing here can move a token, no strategy
 * acts on any of it, and none of it is part of the testnet figures on the rest of the page.
 *
 * Rules:
 *   - Opt-in, every time. No request is made on load, on focus or on a timer: only by the button, which says first
 *     that the address goes to this app's server and to OKX. A wallet change clears the result and sends nothing.
 *   - Per network: a status in words, the tokens, OKX's own USD estimate for the wallet's tokens, and when it was
 *     observed (marked stale after five minutes, on a ticking clock).
 *   - The cross-network total counts only networks that were read with an estimate and says "partial" otherwise.
 *     It is never added to anything testnet.
 *   - Each network has its own committed switch (src/lib/okx-switches.ts). With all of them off this component is
 *     one muted "Planned" line.
 *   - A build pinned to example data never calls the route (src/services/okx.ts). There, `?okx=<scenario>` shows a
 *     synthetic answer of every kind, labelled as an example.
 */
import { useEffect, useRef, useState } from "react";
import { StrategyBadge } from "@/components/domain/strategy-bits";
import { Badge, Button, Card, ExampleTag, Mono, Notice, Skeleton, cx } from "@/components/ui/core";
import { IconAlert } from "@/components/ui/icons";
import { useWallet } from "@/hooks/use-wallet";
import { shortAddress } from "@/lib/format";
import { OKX_NETWORKS, type OkxNetworkView, type OkxPortfolioView, type OkxSubject, type OkxTokenView, buildSubjects, crossNetworkTotal, formatDecimalString, formatUsdString, isSolanaAddress, observation, statusWords } from "@/lib/okx-portfolio";
import { OKX_CHAIN_INDEXES, OKX_SWITCHES, type OkxChainIndex, enabledNetworks } from "@/lib/okx-switches";
import { OKX_SOURCE, lookupPortfolio } from "@/services/okx";
import { OKX_SCENARIO_NOTE, type OkxFixtureScenario, parseOkxScenario } from "@/services/fixture/okx";

export const OTHER_NETWORKS_TITLE = "Other networks · mainnet · read-only via OKX Onchain OS";
const INPUT = "mt-1.5 h-11 w-full min-w-0 rounded-control border border-line-strong bg-bg px-3 font-mono text-[0.8125rem] outline-none focus:border-fg";
/** The placeholder address an example-data build shows when no wallet is connected. Not a real account. */
const EXAMPLE_WALLET = "0x00000000000000000000000000000000000000E1";
const TOKENS_SHOWN = 5;

/** `?okx=<scenario>`, read only in a build pinned to example data. Every other build ignores the parameter. */
export function useOkxScenario(): OkxFixtureScenario | null {
  const [scenario, setScenario] = useState<OkxFixtureScenario | null>(null);
  useEffect(() => {
    if (OKX_SOURCE === "example") setScenario(parseOkxScenario(new URLSearchParams(window.location.search).get("okx")));
  }, []);
  return scenario;
}

/** The current time, advancing while `active`, so "stale" appears without a reload. */
export function useNow(active: boolean, everyMs = 20_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(timer);
  }, [active, everyMs]);
  return now;
}

const names = (indexes: readonly OkxChainIndex[]): string => {
  const list = indexes.map((chainIndex) => OKX_NETWORKS[chainIndex].name);
  return list.length <= 1 ? (list[0] ?? "") : `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`;
};

export function OtherNetworks() {
  const scenario = useOkxScenario();
  const example = OKX_SOURCE === "example";
  const networks = example && scenario ? [...OKX_CHAIN_INDEXES] : enabledNetworks(OKX_SWITCHES);
  if (networks.length === 0) {
    // One line, in the style of the "Planned" bands: dashed, muted, no control.
    return (
      <section aria-label={OTHER_NETWORKS_TITLE} className="rounded-card border border-dashed border-line-strong bg-subtle px-5 py-4 sm:px-6" data-testid="other-networks" data-state="planned" data-networks="">
        <p className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-sm text-muted">
          <StrategyBadge status="planned" />
          <span>{OTHER_NETWORKS_TITLE}. Not available yet: nothing on this page reads another network.</span>
        </p>
      </section>
    );
  }
  return <Lookup networks={networks} scenario={scenario} example={example} />;
}

type LookupState = { phase: "idle" } | { phase: "loading"; subjects: OkxSubject[] } | { phase: "done"; subjects: OkxSubject[]; view: OkxPortfolioView };

function Lookup({ networks, scenario, example }: { networks: OkxChainIndex[]; scenario: OkxFixtureScenario | null; example: boolean }) {
  const wallet = useWallet();
  const connected = wallet.status === "connected" ? wallet.address : null;
  const evm = connected ?? (example ? EXAMPLE_WALLET : null);
  const evmNetworks = networks.filter((chainIndex) => OKX_NETWORKS[chainIndex].kind === "evm");
  const solanaOn = networks.includes("501");
  const planned = OKX_CHAIN_INDEXES.filter((chainIndex) => !networks.includes(chainIndex));

  const [solanaText, setSolanaText] = useState("");
  const solana = solanaText.trim();
  const solanaValid = solanaOn && solana !== "" && isSolanaAddress(solana);
  const solanaError = solanaOn && solana !== "" && !solanaValid;
  const subjects = buildSubjects(networks, evm, solanaValid ? solana : null);

  const [state, setState] = useState<LookupState>({ phase: "idle" });
  const run = useRef(0);
  const pending = useRef<AbortController | null>(null);
  // Another wallet address: what was shown belongs to the previous one. Drop it, cancel a running request, and send
  // nothing for the new address until the button is pressed again.
  useEffect(() => {
    run.current++;
    pending.current?.abort();
    setState({ phase: "idle" });
    return () => pending.current?.abort();
  }, [evm]);

  const lookup = async () => {
    if (subjects.length === 0 || solanaError) return;
    const id = ++run.current;
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    setState({ phase: "loading", subjects });
    const view = await lookupPortfolio(subjects, scenario, controller.signal);
    if (run.current === id) setState({ phase: "done", subjects, view });
  };
  const clear = () => {
    run.current++;
    pending.current?.abort();
    setState({ phase: "idle" });
  };

  const now = useNow(state.phase === "done");
  const view = state.phase === "done" ? state.view : null;
  const asked = subjects.map((subject) => subject.chainIndex);
  const sends = [evm !== null && evmNetworks.length > 0 ? `${connected ? "your wallet address" : "the example address"} ${shortAddress(evm)}` : null, solanaValid ? "the Solana address you typed" : null].filter((part): part is string => part !== null);

  return (
    <Card as="section" aria-labelledby="other-networks-title" data-testid="other-networks" data-state={state.phase} data-networks={networks.join(",")} data-source={OKX_SOURCE} data-credentials={view?.credentials ?? ""}>
      <div className="px-5 pt-5 sm:px-6 sm:pt-6">
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
          <h2 id="other-networks-title" className="min-w-0 text-base font-semibold tracking-tight">
            {OTHER_NETWORKS_TITLE}
          </h2>
          {example ? <ExampleTag /> : <Badge tone="outline">Mainnet · watch only</Badge>}
        </div>
        <p className="mt-1 max-w-3xl text-sm text-muted">
          Wallet tokens of one address on {names(networks)}, as OKX reports them. These are real mainnet balances shown for reference: this app cannot move them, no strategy acts on them, and they are not part of the testnet figures above.
        </p>
        {example ? (
          <p className="mt-2 text-[0.8125rem] text-warning" data-testid="other-networks-example">
            Example data{scenario ? ` (${OKX_SCENARIO_NOTE[scenario]})` : ""}. Every balance below is invented, and this build sends nothing to any server.
          </p>
        ) : null}
      </div>

      <div className="space-y-4 p-5 sm:p-6">
        {solanaOn ? (
          <label className="block max-w-xl text-sm">
            <span className="font-medium">Solana address</span> <span className="text-muted">(optional)</span>
            <input type="text" spellCheck={false} autoComplete="off" autoCapitalize="off" maxLength={64} value={solanaText} onChange={(event) => setSolanaText(event.target.value)} placeholder="A Solana account address" aria-invalid={solanaError} aria-describedby="other-networks-solana-help" className={INPUT} data-testid="other-networks-solana" />
            <span id="other-networks-solana-help" className={cx("mt-1 block text-xs", solanaError ? "text-danger" : "text-faint")} data-testid="other-networks-solana-help" data-valid={solana === "" ? "" : String(solanaValid)}>
              {solanaError ? "This is not a Solana account address: it must be base58 and stand for exactly 32 bytes. Upper and lower case matter." : "A public address only. Your EVM wallet has no Solana address, so it is typed here. Never paste a private key or a seed phrase."}
            </span>
          </label>
        ) : null}

        <div className="rounded-control border border-line bg-subtle p-3.5 text-sm" data-testid="other-networks-consent">
          <p className="text-muted">
            {example ? (
              `In the real app nothing is sent until you press the button; pressing it sends the address to this app's server and to OKX. In this example build the button sends nothing, and shows invented balances for ${names(asked)}.`
            ) : sends.length === 0 ? (
              <>Nothing is sent until you press the button. {evmNetworks.length > 0 ? `Connect a wallet to look up ${names(evmNetworks)}${solanaOn ? ", or type a Solana address" : ""}.` : "Type a Solana address to look it up."}</>
            ) : (
              <>
                Nothing is sent until you press the button. Pressing it sends {sends.join(" and ")} to this app's server and to OKX, which answers with the public token balances of that address on {names(asked)}. The answer may be kept in a shared cache for up to two minutes.
              </>
            )}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button size="sm" disabled={subjects.length === 0 || solanaError || state.phase === "loading"} onClick={() => void lookup()} data-testid="other-networks-lookup" data-subjects={asked.join(",")}>
              {state.phase === "loading" ? "Looking up…" : state.phase === "done" ? "Look up again" : subjects.length <= 1 ? "Look up" : `Look up ${subjects.length} networks`}
            </Button>
            {state.phase === "done" ? (
              <Button size="sm" variant="ghost" onClick={clear} data-testid="other-networks-clear">
                Clear
              </Button>
            ) : null}
          </div>
        </div>

        {state.phase === "loading" ? <Skeleton className="h-32" data-loading /> : null}
        {view && state.phase === "done" ? <Result view={view} now={now} example={example} /> : null}
        {planned.length > 0 ? (
          <p className="text-[0.8125rem] text-faint" data-testid="other-networks-planned">
            Planned, not available yet: {names(planned)}.
          </p>
        ) : null}
      </div>
    </Card>
  );
}

function Result({ view, now, example }: { view: OkxPortfolioView; now: number; example: boolean }) {
  const total = crossNetworkTotal(view.networks);
  const requested = view.networks.length;
  return (
    <div className="space-y-4" data-testid="other-networks-result">
      {view.credentials === "missing" ? (
        <Notice tone="warning" icon={<IconAlert size={18} />} title="Not available right now" data-testid="other-networks-missing">
          This deployment has no OKX read access configured. Nothing was sent to OKX, and no balance is shown.
        </Notice>
      ) : null}
      {requested >= 2 ? (
        <div className="rounded-control border border-line p-4" data-testid="other-networks-total" data-partial={String(total.partial)} data-counted={total.counted.join(",")} data-usd={total.usd ?? ""}>
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted">
            Wallet tokens on {total.counted.length === requested ? `all ${requested} networks` : `${total.counted.length} of ${requested} networks`} · OKX estimate
            {total.partial ? <Badge tone="warning">Partial</Badge> : <Badge tone="success">Complete</Badge>}
            {example ? <ExampleTag /> : null}
          </div>
          <div className="num mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">{total.usd === null ? <span className="font-normal text-faint">No total</span> : formatUsdString(total.usd)}</div>
          <p className="mt-1.5 max-w-3xl text-[0.8125rem] text-muted">
            {total.usd === null ? "No network was read with an estimate, so there is nothing to add up." : total.partial ? `Counts ${names(total.counted)} only. Not counted: ${names(total.notCounted)} (see each card). The real total can be higher.` : "The sum of the four estimates below, each observed at its own time."}{" "}
            Mainnet wallet tokens only, valued by OKX. It is not added to the portfolio value at the top of this page, which counts testnet positions in test tokens.
          </p>
        </div>
      ) : null}
      <ul className="grid gap-3 md:grid-cols-2">
        {view.networks.map((network) => (
          <NetworkCard key={network.chainIndex} network={network} now={now} example={example} />
        ))}
      </ul>
    </div>
  );
}

function NetworkCard({ network, now, example }: { network: OkxNetworkView; now: number; example: boolean }) {
  const words = statusWords(network.status, network.reason);
  const seen = observation(network.observedAt, now);
  const read = network.status === "ok";
  return (
    <li className="min-w-0 rounded-control border border-line p-4" data-testid="other-network" data-network={network.chainIndex} data-status={network.status} data-reason={network.reason ?? ""} data-stale={String(seen.stale)} data-usd={network.walletUsd ?? ""}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">
          {OKX_NETWORKS[network.chainIndex].name} <span className="font-normal text-muted">mainnet</span>
        </h3>
        <Badge tone={words.tone === "success" ? "success" : words.tone === "warning" ? "warning" : "neutral"} wrap>
          <span data-testid="other-network-status">{words.label}</span>
        </Badge>
      </div>
      <p className="mt-1 text-[0.8125rem] text-muted">
        Address <Mono className="text-xs">{network.address}</Mono>
      </p>
      {read ? (
        <>
          <div className="mt-3 flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span className="num text-xl font-semibold tracking-tight" data-testid="other-network-usd">
              {network.walletUsd === null ? <span className="font-normal text-faint">No estimate</span> : formatUsdString(network.walletUsd)}
            </span>
            <span className="text-[0.8125rem] text-muted">OKX estimate · wallet tokens only</span>
            {example ? <ExampleTag /> : null}
          </div>
          <TokenList tokens={network.tokens} />
        </>
      ) : (
        <p className="mt-3 text-sm text-muted" data-testid="other-network-detail">
          {words.detail}
        </p>
      )}
      <p className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-faint" data-testid="other-network-observed">
        <span>
          {read || network.status === "empty" ? "Observed" : "Asked"} {seen.text}
        </span>
        {(read || network.status === "empty") && seen.stale ? <Badge tone="warning">Stale{seen.minutes === null ? "" : ` · ${seen.minutes} min old`}</Badge> : null}
      </p>
    </li>
  );
}

function TokenList({ tokens }: { tokens: OkxTokenView[] }) {
  const first = tokens.slice(0, TOKENS_SHOWN);
  const rest = tokens.slice(TOKENS_SHOWN);
  return (
    <div className="mt-3 text-sm" data-testid="other-network-tokens" data-count={tokens.length}>
      <ul className="divide-y divide-line">
        {first.map((token, index) => (
          <TokenRow key={`${token.tokenAddress ?? "native"}-${index}`} token={token} />
        ))}
      </ul>
      {rest.length > 0 ? (
        <details className="group border-t border-line">
          <summary className="flex min-h-11 items-center text-[0.8125rem] font-medium text-muted hover:text-fg">
            {rest.length} more token{rest.length === 1 ? "" : "s"}
          </summary>
          <ul className="divide-y divide-line border-t border-line">
            {rest.map((token, index) => (
              <TokenRow key={`${token.tokenAddress ?? "native"}-${index}`} token={token} />
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

/** The symbol is the provider's text for a token anyone can create: plain text, cut to a line, never a link. */
function TokenRow({ token }: { token: OkxTokenView }) {
  const symbol = token.symbol.length > 20 ? `${token.symbol.slice(0, 20)}…` : token.symbol;
  return (
    <li className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 py-2" data-token={token.tokenAddress ?? "native"}>
      <span className="min-w-0">
        <span className="font-medium [overflow-wrap:anywhere]">{symbol}</span>{" "}
        <span className="text-xs text-faint">{token.isNative ? "native" : token.tokenAddress ? <span className="font-mono">{shortAddress(token.tokenAddress)}</span> : null}</span>
      </span>
      <span className="num ml-auto min-w-0 text-right">
        <span className="[overflow-wrap:anywhere]">{formatDecimalString(token.balance, 6)}</span>
        <span className="block text-xs text-faint">{token.priceUsd === null ? "no price from OKX" : `at ${formatUsdString(token.priceUsd)} each`}</span>
      </span>
    </li>
  );
}
