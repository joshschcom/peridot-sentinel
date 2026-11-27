"use client";
/**
 * Discover, third tier: strategies published to the public strategy registry (docs/STRATEGY_REGISTRY.md).
 *
 * Anyone can publish, so every item shows WHO published it (the full address) and WHICH version it is (versions are
 * immutable); two people can use the same name. An item is listed as a strategy only after the SDK accepted it: the
 * pinned registry code, the event, the stored bytes, their hash, the canonical encoding, the strategy validator and
 * the index labels. Anything else is listed apart as rejected, with the SDK's reason, without any of its text and
 * without a control. Names, descriptions and instructions are a stranger's words: plain text, never a link, never
 * acted on. Publishing gives the publisher nothing; adoption goes through the same owner review as any template.
 *
 * The history is read in pages of 100 blocks through head − 12. Which blocks were read, which were not read yet and
 * which the RPC did not serve is always stated: an unread range never reads as "nothing published".
 */
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { StrategyBadge, TemplateFacts, TemplateText } from "@/components/domain/strategy-bits";
import { Advanced, Badge, Button, ButtonLink, Card, Mono, Notice, Skeleton } from "@/components/ui/core";
import { IconAlert, IconArrowRight, IconArrowUpRight } from "@/components/ui/icons";
import { IS_PRIVATE_FORK, explorerAddressUrl, explorerTxUrl } from "@/lib/chains";
import { shortHash } from "@/lib/format";
import { CURATED, STRATEGY_AVAILABILITY_LABEL, modeLabel, templateAvailability, templateFacts } from "@/lib/strategy";
import { REGISTRY_PIN, STRATEGY_CONTEXT } from "@/lib/strategy-context";
import { type CoverageRange, type RegistryPinFile, blocksIn, publicationHref, rejectionMeaning } from "@/lib/strategy-registry";
import { type PublishedStrategy, type RejectedPublication, scanRegistry } from "@/services/chain/registry";

/** Pages read when the page opens: the first three (the registry's first 300 blocks) and the latest three. More only when the reader asks. */
const EARLY_PAGES = 3;
const HEAD_PAGES = 3;
const MORE_PAGES = 5;
const group = (value: bigint | number) => value.toLocaleString("en-US");
/** A fork holds the public registry's history up to the fork point plus whatever was published on the fork itself. */
export const PUBLISHED_HEADING = IS_PRIVATE_FORK ? "Published on this private fork" : "Published on testnet";
const WHERE = IS_PRIVATE_FORK ? "this private fork of X Layer testnet (not the public chain)" : "X Layer testnet";

export function PublishedBand() {
  return REGISTRY_PIN ? <Band pin={REGISTRY_PIN} /> : null;
}

function Band({ pin }: { pin: RegistryPinFile }) {
  // "Read more" grows the recent end backwards: what was published lately is what a reader is most likely looking for.
  const [head, setHead] = useState(HEAD_PAGES);
  const scan = useQuery({ queryKey: ["registry-scan", pin.address, head], queryFn: () => scanRegistry(pin, { early: EARLY_PAGES, head }), staleTime: 60_000, retry: 0, placeholderData: keepPreviousData });
  const data = scan.data;
  const state = !data ? (scan.isError ? "unreachable" : "loading") : data.state;
  const verified = data?.state === "verified" ? data : null;
  return (
    <section aria-labelledby="discover-published" className="space-y-3" data-testid="discover-published" data-state={state} data-accepted={verified ? verified.accepted.length : ""} data-rejected={verified ? verified.rejected.length : ""} data-confirmed={verified ? verified.confirmed.toString() : ""} data-registry={pin.address}>
      <div>
        <h2 id="discover-published" className="flex flex-wrap items-center gap-2.5 text-lg font-semibold tracking-tight">
          {PUBLISHED_HEADING}
          {verified ? <span className="num rounded-full bg-raised px-2 py-0.5 text-xs font-medium text-muted">{verified.accepted.length}</span> : null}
        </h2>
        <p className="mt-1 max-w-3xl text-sm text-muted" data-testid="published-intro">
          Strategies that anyone has posted to the public strategy registry on {WHERE}. Each one shows the address that published it and its version, which can never be changed. Publishing gives the publisher no access to anything: if you adopt one, you choose the operator, set the limits and sign for your own account. A listing here says which text an address published. It is not a recommendation.
        </p>
      </div>

      {state === "loading" ? (
        <div className="space-y-2" data-testid="published-loading">
          <p className="text-sm text-muted">Checking the registry and reading its history…</p>
          <Skeleton className="h-28" data-loading />
        </div>
      ) : null}

      {data && data.state !== "verified" ? (
        <Notice tone="warning" icon={<IconAlert size={18} />} title={data.state === "mismatch" ? "Published strategies are not shown: the registry could not be verified" : "Published strategies are not shown: the registry could not be read"} data-testid="published-unverified" data-why={data.state}>
          {data.state === "mismatch" ? `The contract at the registry address is not the one this app was built for (${data.reason}). ` : `The network did not answer the registry check (${data.reason}). `}
          Nothing from it is listed and nothing from it can be adopted. The curated strategies above do not depend on it.
        </Notice>
      ) : null}
      {!data && scan.isError ? (
        <Notice tone="warning" icon={<IconAlert size={18} />} title="Published strategies are not shown: the registry could not be read" data-testid="published-unverified" data-why="unreachable">
          Nothing from it is listed and nothing from it can be adopted. The curated strategies above do not depend on it.
        </Notice>
      ) : null}

      {verified ? (
        <>
          {verified.accepted.length === 0 ? <p className="text-sm text-muted" data-testid="published-none">No accepted publication in the blocks read so far (see below for what was read).</p> : null}
          <ul className="grid gap-4 lg:grid-cols-2" data-testid="published-list">
            {verified.accepted.map((item) => (
              <PublishedCard key={`${item.transactionHash}:${item.logIndex}`} item={item} />
            ))}
          </ul>
          {verified.rejected.length > 0 ? <RejectedList items={verified.rejected} /> : null}
          <Coverage pin={pin} ranges={verified.ranges} pages={verified.pages} pagesRead={verified.pagesRead} confirmed={verified.confirmed} busy={scan.isFetching} onMore={() => setHead((value) => value + MORE_PAGES)} onRetry={() => void scan.refetch()} />
        </>
      ) : null}
    </section>
  );
}

function PublishedCard({ item }: { item: PublishedStrategy }) {
  const [open, setOpen] = useState(false);
  const template = item.template;
  const availability = templateAvailability(template, STRATEGY_CONTEXT);
  const facts = templateFacts(template);
  const pick = (label: string) => facts.find((fact) => fact.label === label)?.value ?? "";
  const curated = CURATED.find((entry) => entry.hash.toLowerCase() === item.hash.toLowerCase());
  const txUrl = explorerTxUrl(1952, item.transactionHash);
  const creatorUrl = explorerAddressUrl(1952, item.creator);
  const key = { creator: item.creator, seriesId: item.seriesId, version: item.version, block: item.publishedBlock };
  return (
    <Card as="li" className="flex flex-col" data-testid="published-card" data-creator={item.creator} data-series={item.seriesId} data-version={item.version} data-hash={item.hash} data-block={item.publishedBlock.toString()} data-profile={template.profile} data-availability={availability.status} data-can-sign={String(availability.canSign)}>
      <div className="flex-1 space-y-4 p-5 sm:p-6">
        <div className="flex flex-wrap items-center gap-2">
          <StrategyBadge status={availability.status} />
          <Badge tone="outline">
            <span data-testid="published-version">Version {item.version} · cannot be changed</span>
          </Badge>
          <Badge tone="outline">{modeLabel(template)}</Badge>
          <Badge tone="outline">Account {template.deployment.accountVersion}</Badge>
        </div>
        <div>
          <h3 className="text-xl font-semibold tracking-tight break-words" data-testid="published-name">{template.name}</h3>
          <p className="mt-1.5 text-[0.9375rem] break-words text-muted">{template.description}</p>
          <p className="mt-1.5 text-xs text-warning">Name and description are the publisher&apos;s own words, shown exactly as written.</p>
        </div>
        <dl className="divide-y divide-line text-sm">
          <div className="py-2">
            <dt className="text-muted">Published by</dt>
            <dd className="mt-0.5">
              <Mono className="break-all text-fg"><span data-testid="published-creator">{item.creator}</span></Mono>
              {creatorUrl ? (
                <a href={creatorUrl} target="_blank" rel="noreferrer" className="ml-2 inline-flex items-center gap-1 text-[0.8125rem] text-muted underline underline-offset-4">
                  explorer <IconArrowUpRight size={12} />
                </a>
              ) : null}
            </dd>
          </div>
          {["Operation", "Budget", "Grant lifetime"].map((label) => (
            <div key={label} className="num flex flex-col gap-0.5 py-2 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
              <dt className="shrink-0 text-muted">{label}</dt>
              <dd className="min-w-0 break-words sm:text-right">{pick(label)}</dd>
            </div>
          ))}
          <div className="num flex flex-col gap-0.5 py-2 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
            <dt className="shrink-0 text-muted">Published in block</dt>
            <dd className="min-w-0 break-words sm:text-right">
              {group(item.publishedBlock)}
              {" · "}
              {txUrl ? (
                <a href={txUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-mono text-fg underline underline-offset-4">
                  {shortHash(item.transactionHash)} <IconArrowUpRight size={12} />
                </a>
              ) : (
                <span className="font-mono">{shortHash(item.transactionHash)}</span>
              )}
            </dd>
          </div>
        </dl>
        <p className="text-xs text-faint">
          {curated ? <span data-testid="published-same-as-curated">Its text is identical to the curated “{curated.template.name}” strategy above (same content hash). </span> : null}
          Budget and time limit are the publisher&apos;s suggestions: set your own before you sign. Test tokens, mock prices{template.profile === "restricted-swap-v2" ? ", mock swap venue" : ""}.
        </p>
        {availability.reason ? <p className="text-[0.8125rem] text-warning">{availability.reason}</p> : null}
        {open ? (
          <div className="space-y-4 border-t border-line pt-4" data-testid="published-details">
            <TemplateText label="Objective" text={template.objective} untrusted source="published" />
            <TemplateText label="Instructions for the agent" text={template.agentInstructions} untrusted source="published" />
            <p className="text-xs text-faint">Instructions are a note from the publisher for whoever runs an operator. This app does not act on them, does not send them anywhere and no contract reads them.</p>
            <TemplateFacts template={template} />
            <dl className="space-y-2 text-[0.8125rem]">
              <div>
                <dt className="text-muted">Series (chosen by the publisher)</dt>
                <dd className="font-mono break-all">{item.seriesId}</dd>
              </div>
              <div>
                <dt className="text-muted">Content hash, recomputed from the stored bytes</dt>
                <dd className="font-mono break-all" data-testid="published-hash">{item.hash}</dd>
              </div>
              <div>
                <dt className="text-muted">Publication transaction</dt>
                <dd className="font-mono break-all">{item.transactionHash}</dd>
              </div>
            </dl>
            <Advanced label="Canonical JSON, as stored in the registry">
              <pre className="max-h-64 overflow-auto font-mono text-xs break-all whitespace-pre-wrap">{item.canonical}</pre>
            </Advanced>
          </div>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-2 border-t border-line p-5 sm:px-6">
        <Button variant="secondary" onClick={() => setOpen((value) => !value)} aria-expanded={open} data-testid="published-inspect">
          {open ? "Hide details" : "Inspect"}
        </Button>
        {availability.canReview ? (
          <ButtonLink href={publicationHref(key)} data-testid="published-adopt">
            {availability.canSign ? "Adopt" : "Review the transaction"} <IconArrowRight size={16} />
          </ButtonLink>
        ) : (
          <span className="inline-flex h-11 items-center text-sm text-muted" data-testid="published-adopt-off">
            {STRATEGY_AVAILABILITY_LABEL[availability.status]}: adoption is not offered in this build
          </span>
        )}
      </div>
    </Card>
  );
}

/** Rejected publications: who, which version, where, and why. Nothing of their content, and nothing to press. */
function RejectedList({ items }: { items: RejectedPublication[] }) {
  return (
    <div className="rounded-card border border-line p-5 sm:p-6" data-testid="published-rejected-list">
      <h3 className="flex flex-wrap items-center gap-2.5 text-base font-semibold tracking-tight">
        Rejected publications
        <span className="num rounded-full bg-raised px-2 py-0.5 text-xs font-medium text-muted">{items.length}</span>
      </h3>
      <p className="mt-1 max-w-3xl text-sm text-muted">The registry stores whatever is posted to it. These posts did not pass the checks, so they are not strategies here: their text is not shown and they cannot be adopted.</p>
      <ul className="mt-3 divide-y divide-line text-sm">
        {items.map((item) => {
          const txUrl = explorerTxUrl(1952, item.transactionHash);
          return (
            <li key={`${item.transactionHash}:${item.logIndex}`} className="space-y-1.5 py-3" data-testid="published-rejected" data-creator={item.creator} data-series={item.seriesId} data-version={item.version} data-block={item.publishedBlock.toString()} data-reason={item.reason}>
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone="danger">Rejected · cannot be adopted</Badge>
                <span className="num text-muted">Version {item.version} · block {group(item.publishedBlock)}</span>
              </div>
              <p data-testid="published-rejected-reason">
                {rejectionMeaning(item.reason)} <span className="text-muted">Check result: “{item.reason}”.</span>
              </p>
              <p className="text-[0.8125rem] text-muted">
                Posted by <span className="font-mono break-all text-fg">{item.creator}</span>, series <span className="font-mono break-all">{shortHash(item.seriesId)}</span>, transaction{" "}
                {txUrl ? (
                  <a href={txUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-mono underline underline-offset-4">
                    {shortHash(item.transactionHash)} <IconArrowUpRight size={12} />
                  </a>
                ) : (
                  <span className="font-mono">{shortHash(item.transactionHash)}</span>
                )}
                .
              </p>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

const STATUS_TEXT: Record<CoverageRange["status"], string> = { read: "Read", "not-read": "Not read yet", unavailable: "Could not be read" };

function Coverage({ pin, ranges, pages, pagesRead, confirmed, busy, onMore, onRetry }: { pin: RegistryPinFile; ranges: CoverageRange[]; pages: number; pagesRead: number; confirmed: bigint; busy: boolean; onMore: () => void; onRetry: () => void }) {
  const notRead = ranges.filter((range) => range.status === "not-read");
  const failed = ranges.filter((range) => range.status === "unavailable");
  const complete = notRead.length === 0 && failed.length === 0;
  return (
    <div className="rounded-control border border-line p-4 text-sm" data-testid="published-coverage" data-complete={String(complete)} data-pages={pages} data-pages-read={pagesRead}>
      <p className="text-muted">
        {complete ? "Every block of the registry's history was read" : `${group(pagesRead)} of ${group(pages)} pages of the registry's history were read`}: from its deployment block <span className="num text-fg">{group(pin.deploymentBlock)}</span> through block <span className="num text-fg">{group(confirmed)}</span>, which is the latest block minus {pin.confirmations} confirmations, 100 blocks at a time.
        {complete ? "" : " A publication in a range that was not read does not appear above."}
      </p>
      <ul className="num mt-2 space-y-1">
        {ranges.map((range) => (
          <li key={`${range.from}`} className={range.status === "read" ? "text-muted" : range.status === "unavailable" ? "text-warning" : "text-fg"} data-coverage={range.status} data-from={range.from.toString()} data-to={range.to.toString()}>
            {STATUS_TEXT[range.status]}: blocks {group(range.from)} to {group(range.to)} ({group(blocksIn(range))} blocks){range.reason ? <span className="[overflow-wrap:anywhere]">. The network answered: {range.reason}</span> : null}
          </li>
        ))}
      </ul>
      {complete ? null : (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {notRead.length > 0 ? (
            <Button size="sm" variant="secondary" disabled={busy} onClick={onMore} data-testid="published-scan-more">
              {busy ? "Reading…" : `Read ${MORE_PAGES} more pages, going back from the latest`}
            </Button>
          ) : null}
          {failed.length > 0 ? (
            <Button size="sm" variant="secondary" disabled={busy} onClick={onRetry} data-testid="published-scan-retry">
              {busy ? "Reading…" : "Try the unread ranges again"}
            </Button>
          ) : null}
        </div>
      )}
      <Advanced label="Which registry" className="mt-3">
        <dl className="space-y-2 text-[0.8125rem]">
          <div>
            <dt className="text-muted">Registry contract</dt>
            <dd className="font-mono break-all">{pin.address}</dd>
          </div>
          <div>
            <dt className="text-muted">Runtime code hash this app requires</dt>
            <dd className="font-mono break-all">{pin.runtimeCodeHash}</dd>
          </div>
        </dl>
        <p className="mt-2 text-xs text-faint">The address and code hash are fixed in this build from the reviewed deployment. No publication can change them. The registry has no owner and no upgrade.</p>
      </Advanced>
    </div>
  );
}
