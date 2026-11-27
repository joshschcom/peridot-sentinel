"use client";
/**
 * "Publish this strategy": post the validated strategy text to the public strategy registry, as the next version of
 * a series under the publisher's own address (docs/STRATEGY_REGISTRY.md).
 *
 *   prepare   the SDK (`buildStrategyPublication`) validates and canonicalises the text, checks the registry code and
 *             the next version, and returns one unsigned, zero-value transaction;
 *   review    registry address, sender, every argument and the exact calldata are shown;
 *   sign      by the connected wallet; the driver refuses anything but the reviewed calldata from the reviewed sender;
 *   read back after the registry's confirmations the publication is read again with the same checks a reader's
 *             Discover page makes, and only then called published.
 * Publishing grants nothing: not to the publisher over anyone's account, and not to anyone over the publisher's.
 * A post is permanent and public; the page says so before the wallet is asked.
 */
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useEffect, useState } from "react";
import { TxFeedback } from "@/components/domain/tx-feedback";
import { Advanced, Button, Mono, Notice } from "@/components/ui/core";
import { IconAlert, IconLock, IconShield } from "@/components/ui/icons";
import { useChainTx } from "@/hooks/use-chain-tx";
import { useWallet, useWriteGate } from "@/hooks/use-wallet";
import { IS_PRIVATE_FORK, WRITE_CHAIN_ID } from "@/lib/chains";
import type { CheckedStrategy } from "@/lib/strategy";
import { REGISTRY_PIN, REGISTRY_PUBLISH_ON } from "@/lib/strategy-context";
import { type PublicationKey, publicationHref, seriesIdFromName } from "@/lib/strategy-registry";
import { type PreparedPublication, preparePublication, publicationArgs, publicationStep, readPublication } from "@/services/chain/registry";
import type { Address } from "@/services/types";

const INPUT = "mt-1.5 h-11 w-full min-w-0 rounded-control border border-line-strong bg-bg px-3 text-[0.9375rem] outline-none focus:border-fg";
const ARGS = ["seriesId", "expectedVersion", "targetChainId", "adapterVersion", "policyKey", "canonicalJson"] as const;

export function PublishPanel({ strategy }: { strategy: CheckedStrategy }) {
  const pin = REGISTRY_PIN;
  const wallet = useWallet();
  const gate = useWriteGate("account");
  const tx = useChainTx();
  const creator = wallet.status === "connected" ? (wallet.address as Address) : null;
  const [name, setName] = useState("");
  const [prepared, setPrepared] = useState<PreparedPublication | null>(null);
  const [busy, setBusy] = useState(false);
  const [mined, setMined] = useState<PublicationKey | null>(null);
  const seriesId = seriesIdFromName(name);
  const reset = tx.reset;
  // What would be published is exactly what is on screen: any change discards the prepared transaction.
  useEffect(() => {
    setPrepared(null);
    setMined(null);
    reset();
  }, [strategy.hash, name, creator, reset]);
  // After the transaction is mined: read it back from the registry once it has its confirmations.
  const readback = useQuery({
    queryKey: ["registry-publication", mined?.creator, mined?.seriesId, mined?.version, mined?.block.toString()],
    queryFn: () => readPublication(pin!, mined!),
    enabled: pin !== null && mined !== null,
    retry: 0,
    refetchInterval: (query) => (query.state.data?.state === "verified" || query.state.data?.state === "rejected" || query.state.data?.state === "mismatch" ? false : 4000),
  });
  if (!pin || !REGISTRY_PUBLISH_ON) return null;
  const where = IS_PRIVATE_FORK ? "the strategy registry on this private fork (not the public chain)" : "the public strategy registry on X Layer testnet";
  const publication = prepared?.ok ? prepared.publication : null;

  const prepare = async () => {
    if (!creator || !seriesId) return;
    setBusy(true);
    setPrepared(await preparePublication(pin, { creator, seriesId, canonical: strategy.canonical }));
    setBusy(false);
  };
  const sign = async () => {
    if (!publication) return;
    const run = await tx.run([publicationStep(publication)], "Mined. It is read back from the registry below, once it has its confirmations.");
    const receipt = run.receipts[0];
    if (run.ok && receipt) setMined({ creator: publication.from, seriesId: publication.seriesId, version: publication.expectedVersion, block: receipt.blockNumber });
  };
  const back = readback.data ?? null;
  const verified = back?.state === "verified" ? back.item : null;

  return (
    <details className="group rounded-control border border-line" id="publish" data-testid="strategy-publish">
      <summary className="flex min-h-11 items-center justify-between gap-3 px-3.5 text-sm font-medium text-muted hover:text-fg">Publish this strategy</summary>
      <div className="space-y-4 border-t border-line p-3.5 text-sm">
        <p className="text-muted">
          Post this strategy to {where}, so anyone can find it on Discover under your address. What is posted is the strategy text and the values above, and nothing else: no key, no account, no operator and no grant.
        </p>
        <Notice tone="warning" icon={<IconAlert size={18} />} title="A post is public and permanent" data-testid="publish-permanent">
          Once mined it can never be edited or removed, by you or anyone. You can only add a new version next to it. Publishing gives you no access to anyone&apos;s account, and nobody access to yours: whoever adopts it chooses their own operator and signs for their own account. You pay the network fee (about 1.1 million gas for a strategy of this size); the registry charges nothing.
        </Notice>
        <label className="block">
          <span className="font-medium">Series name</span>
          <input type="text" spellCheck={false} autoComplete="off" maxLength={32} value={name} onChange={(event) => setName(event.target.value.trim().toLowerCase())} placeholder="my-debt-guard" className={INPUT} data-testid="publish-series" />
          <span className="mt-1 block text-xs text-faint">Lower-case letters, digits and hyphens. Your posts under one name are versions 1, 2, 3 of the same series. Only a hash of the name is stored.</span>
        </label>
        {name !== "" && !seriesId ? <p className="text-danger">Use 1 to 32 lower-case letters or digits, with single hyphens between them.</p> : null}
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="secondary" disabled={!creator || !seriesId || busy || tx.state.phase === "running" || mined !== null} onClick={() => void prepare()} data-testid="publish-prepare">
            {busy ? "Reading the registry…" : publication ? "Prepare again" : "Prepare the publication"}
          </Button>
          {!creator ? <span className="text-[0.8125rem] text-muted">Connect the wallet you want to publish from.</span> : null}
        </div>
        {prepared && !prepared.ok ? (
          <Notice tone="warning" icon={<IconAlert size={18} />} title="No publication was prepared" data-testid="publish-error">
            {prepared.reason}. Nothing was sent.
          </Notice>
        ) : null}

        {publication && prepared?.ok ? (
          <div className="space-y-3 rounded-control border border-line-strong p-3.5" data-testid="publish-review" data-to={publication.to} data-from={publication.from} data-version={publication.expectedVersion} data-series={publication.seriesId} data-hash={publication.contentHash} data-data={publication.data}>
            <h4 className="font-medium">Review the publication</h4>
            <dl className="space-y-1.5 text-[0.8125rem]">
              <div className="flex flex-wrap gap-x-2">
                <dt className="text-muted">Network</dt>
                <dd>{IS_PRIVATE_FORK ? "Private fork of X Layer testnet (1952). Not the public chain." : "X Layer testnet (1952)"}</dd>
              </div>
              <div className="flex flex-wrap gap-x-2">
                <dt className="text-muted">From (you, the publisher) → to (the registry)</dt>
                <dd className="font-mono break-all">
                  <span data-testid="publish-from">{publication.from}</span> → <span data-testid="publish-to">{publication.to}</span>
                </dd>
              </div>
              <div className="flex flex-wrap gap-x-2">
                <dt className="text-muted">Call</dt>
                <dd className="font-mono break-all">publish({ARGS.join(", ")})</dd>
              </div>
              {publicationArgs(publication).map((value, index) => (
                <div key={ARGS[index]} className="flex flex-wrap gap-x-2" data-arg={ARGS[index]}>
                  <dt className="text-muted">{ARGS[index]}</dt>
                  <dd className="min-w-0">
                    {ARGS[index] === "canonicalJson" ? (
                      <span>
                        <span data-arg-raw>{prepared.bytes.toLocaleString("en-US")} bytes</span>
                        <span className="text-muted"> · the strategy text above, content hash </span>
                        <span className="font-mono break-all" data-testid="publish-hash">{publication.contentHash}</span>
                      </span>
                    ) : (
                      <>
                        <span className="font-mono break-all" data-arg-raw>{String(value)}</span>
                        <span className="text-muted">
                          {ARGS[index] === "seriesId" ? " · your series (hash of the name you typed)" : ARGS[index] === "expectedVersion" ? " · the version this post becomes; it fails if another post took it first" : ARGS[index] === "targetChainId" ? " · X Layer testnet" : ARGS[index] === "adapterVersion" ? " · index label: hash of the adapter version in the strategy" : " · index label: hash of the policy identity in the strategy"}
                        </span>
                      </>
                    )}
                  </dd>
                </div>
              ))}
              <div className="flex flex-wrap gap-x-2">
                <dt className="text-muted">Value</dt>
                <dd className="font-mono">0</dd>
              </div>
            </dl>
            <Advanced label="Exact calldata">
              <code className="font-mono text-xs break-all" data-testid="publish-calldata">{publication.data}</code>
            </Advanced>
            {mined === null ? (
              <div className="space-y-2">
                <Button disabled={!gate.allowed || tx.state.phase === "running"} onClick={() => void sign()} data-testid="publish-sign">
                  {!gate.allowed ? <IconLock size={16} /> : null} Sign and publish version {publication.expectedVersion}
                </Button>
                <p className="text-[0.8125rem] text-muted">{gate.allowed ? "One transaction. It stores text in the registry and changes nothing else. It cannot be undone." : gate.message}</p>
              </div>
            ) : null}
            <TxFeedback state={tx.state} chainId={WRITE_CHAIN_ID} />
          </div>
        ) : null}

        {mined ? (
          verified ? (
            <Notice tone="success" icon={<IconShield size={18} />} title={`Published: version ${verified.version}, read back from the registry`} data-testid="publish-readback" data-state="verified" data-hash={verified.hash} data-version={verified.version} data-block={verified.publishedBlock.toString()} data-creator={verified.creator}>
              The registry holds this text as version {verified.version} of your series, posted by <Mono className="break-all">{verified.creator}</Mono> in block {verified.publishedBlock.toLocaleString("en-US")}. It was read again with the checks every reader&apos;s page makes{verified.hash === strategy.hash ? ", and its content hash equals the one above" : ""}. You hold no authority over anyone who adopts it.
              <span className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
                <Link href={publicationHref(mined)} className="font-medium underline underline-offset-4" data-testid="publish-link">
                  Open it as an adopter sees it
                </Link>
                <Link href="/discover" className="font-medium underline underline-offset-4">
                  See it on Discover
                </Link>
              </span>
            </Notice>
          ) : (
            <Notice tone={back?.state === "rejected" || back?.state === "mismatch" ? "warning" : "neutral"} icon={<IconAlert size={18} />} title={back?.state === "rejected" ? "Mined, but the registry's copy does not verify" : "Mined. Not read back yet"} data-testid="publish-readback" data-state={back?.state ?? "loading"}>
              {back?.state === "rejected" ? `Check result: “${back.item.reason}”. It is not listed as a strategy.` : back && "reason" in back ? `${back.reason.charAt(0).toUpperCase()}${back.reason.slice(1)}. This page keeps asking.` : `Waiting for ${pin.confirmations} confirmations after block ${mined.block.toLocaleString("en-US")}, then reading it back.`}
            </Notice>
          )
        ) : null}
      </div>
    </details>
  );
}
