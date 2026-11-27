"use client";
/**
 * Discover (DECISIONS D23): the curated strategy templates, then what anyone has published to the public strategy
 * registry (discover-published.tsx), then what is planned. Every curated card is one of the SDK's own templates, bound
 * to contracts deployed on X Layer testnet. There is no performance, yield, TVL, user count or creator earning on this
 * page, because none exists: the assets are test tokens and nobody has earned anything.
 * A label is derived from what this build lets a user do with the template (src/lib/strategy.ts), never typed in.
 */
import { useState } from "react";
import { Disclosures } from "@/components/domain/disclosures";
import { StrategyBadge, TemplateFacts, TemplateIdentity, TemplateText } from "@/components/domain/strategy-bits";
import { PLANNED_STRATEGIES, STRATEGY_CONTEXT } from "@/lib/strategy-context";
import { Advanced, Badge, Button, ButtonLink, Card, PageHeader } from "@/components/ui/core";
import { IconArrowRight, IconArrowUpRight } from "@/components/ui/icons";
import { explorerTxUrl } from "@/lib/chains";
import { EVIDENCE } from "@/lib/evidence";
import { EXPANSION } from "@/lib/expansion";
import { shortHash } from "@/lib/format";
import { PublishedBand } from "./discover-published";
import { CURATED, type CheckedStrategy, STRATEGY_AVAILABILITY_LABEL, modeLabel, templateAvailability, templateFacts } from "@/lib/strategy";

export function Discover() {
  // The heading over the cards is derived like every label on them: it says "available" only when each can be signed here.
  const allAvailable = CURATED.length > 0 && CURATED.every((entry) => templateAvailability(entry.template, STRATEGY_CONTEXT).status === "available");
  return (
    <div className="space-y-6" data-testid="discover">
      <PageHeader
        eyebrow="Personal"
        title="Discover"
        description="Discover reusable financial strategies. See exactly what each one may do, set your own limits, and adopt it while keeping control of your account."
        actions={
          <ButtonLink href="/strategies#import" variant="secondary">
            Adopt a shared strategy
          </ButtonLink>
        }
      />
      <Disclosures className="max-w-4xl" />

      <section aria-labelledby="discover-available" className="space-y-3" data-testid="discover-available" data-all-available={String(allAvailable)}>
        <div>
          <h2 id="discover-available" className="flex flex-wrap items-center gap-2.5 text-lg font-semibold tracking-tight">
            {allAvailable ? "Available on testnet" : "Strategies in this build"}
            <span className="num rounded-full bg-raised px-2 py-0.5 text-xs font-medium text-muted">{CURATED.length}</span>
          </h2>
          <p className="mt-1 max-w-3xl text-sm text-muted" data-testid="discover-no-metrics">
            {allAvailable ? "Adopt these today with your own wallet. " : ""}Performance figures are not shown, because none exist yet. What you can check instead is exactly what each strategy may do.
          </p>
        </div>
        {CURATED.length === 0 ? <p className="text-sm text-muted">The curated strategies are not available in this build.</p> : null}
        <ul className="grid gap-4 lg:grid-cols-2">
          {CURATED.map((entry) => (
            <TemplateCard key={entry.hash} entry={entry} />
          ))}
        </ul>
      </section>

      {/* Third tier: what anyone has posted to the public registry. Rendered only when this build reads it. */}
      <PublishedBand />

      <section aria-labelledby="discover-labels" className="rounded-card border border-line p-5 sm:p-6">
        <h2 id="discover-labels" className="text-base font-semibold tracking-tight">What the labels mean</h2>
        <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-3">
          <div>
            <dt><StrategyBadge status="available" /></dt>
            <dd className="mt-2 text-muted">Review exactly what you approve and sign it with your own wallet, on X Layer testnet.</dd>
          </div>
          <div>
            <dt><StrategyBadge status="demonstration" /></dt>
            <dd className="mt-2 text-muted">Genuine and already run on testnet, but this build does not let you sign it. Where possible you can still review it.</dd>
          </div>
          <div>
            <dt><StrategyBadge status="planned" /></dt>
            <dd className="mt-2 text-muted">On the roadmap. Nothing to adopt yet, and no date is promised.</dd>
          </div>
        </dl>
      </section>

      {/* Future categories: a separate band, dashed and muted, with no button anywhere in it. */}
      <section aria-labelledby="discover-planned" className="rounded-card border border-dashed border-line-strong bg-subtle p-5 sm:p-6" data-testid="discover-planned">
        <h2 id="discover-planned" className="flex flex-wrap items-center gap-2.5 text-lg font-semibold tracking-tight text-muted">
          Planned
          <span className="text-sm font-normal">Not available yet. Nothing in this section can be adopted.</span>
        </h2>
        <ul className="mt-4 grid gap-3 md:grid-cols-3">
          {PLANNED_STRATEGIES.map((item) => (
            <li key={item.name} className="rounded-card border border-dashed border-line-strong p-5" data-planned={item.name}>
              <StrategyBadge status="planned" />
              <h3 className="mt-3 font-medium text-muted">{item.name}</h3>
              <p className="mt-1.5 text-sm text-muted">{item.body}</p>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

/** A recorded public testnet transaction of this kind of operation. Evidence about the mechanism, on a demonstration account. */
function recorded(entry: CheckedStrategy): { text: string; hash: string; url: string | null } | null {
  if (entry.template.profile === "debt-protection-v1") {
    const repay = EVIDENCE.testnetAutoRepay;
    return repay.status === "ok" ? { text: "A repay-only operator has executed this kind of repayment on testnet, on a demonstration account", hash: repay.value.hash, url: explorerTxUrl(repay.value.chainId, repay.value.hash) } : null;
  }
  const swap = EXPANSION.demo.status === "ok" ? EXPANSION.demo.value.operatorSwap : null;
  return swap ? { text: "An operator has executed this kind of swap on testnet through the mock venue, on a demonstration account", hash: swap.hash, url: explorerTxUrl(1952, swap.hash) } : null;
}

function TemplateCard({ entry }: { entry: CheckedStrategy }) {
  const [open, setOpen] = useState(false);
  const template = entry.template;
  const availability = templateAvailability(template, STRATEGY_CONTEXT);
  const facts = templateFacts(template);
  const pick = (label: string) => facts.find((fact) => fact.label === label)?.value ?? "";
  const proof = recorded(entry);
  return (
    <Card as="li" className="flex flex-col" data-testid="discover-card" data-profile={template.profile} data-availability={availability.status} data-can-sign={String(availability.canSign)}>
      <div className="flex-1 space-y-4 p-5 sm:p-6">
        <div className="flex flex-wrap items-center gap-2">
          <StrategyBadge status={availability.status} />
          <Badge tone="outline">{modeLabel(template)}</Badge>
          <Badge tone="outline">Account {template.deployment.accountVersion}</Badge>
        </div>
        <div>
          <h2 className="text-xl font-semibold tracking-tight">{template.name}</h2>
          <p className="mt-1.5 text-[0.9375rem] text-muted">{template.description}</p>
        </div>
        <dl className="num divide-y divide-line text-sm">
          {["Operation", "Budget", "Grant lifetime"].map((label) => (
            <div key={label} className="flex flex-col gap-0.5 py-2 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
              <dt className="shrink-0 text-muted">{label}</dt>
              <dd className="min-w-0 break-words sm:text-right">{pick(label)}</dd>
            </div>
          ))}
        </dl>
        <p className="text-xs text-faint">Budget and time limit are suggestions: set your own before you sign. Test tokens, mock prices{template.profile === "restricted-swap-v2" ? ", mock swap venue" : ""}.</p>
        {availability.reason ? <p className="text-[0.8125rem] text-warning" data-testid="discover-reason">{availability.reason}</p> : null}
        {proof ? (
          <p className="text-[0.8125rem] text-muted" data-testid="discover-recorded">
            {proof.text}:{" "}
            {proof.url ? (
              <a href={proof.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-mono text-fg underline underline-offset-4">
                {shortHash(proof.hash)} <IconArrowUpRight size={12} />
              </a>
            ) : (
              <span className="font-mono">{shortHash(proof.hash)}</span>
            )}
            . Shown as proof that it works, not as a result to expect.
          </p>
        ) : null}
        {open ? (
          <div className="space-y-4 border-t border-line pt-4" data-testid="discover-details">
            <TemplateText label="Objective" text={template.objective} untrusted={false} />
            <TemplateText label="Instructions for the agent" text={template.agentInstructions} untrusted={false} />
            <TemplateFacts template={template} />
            <TemplateIdentity strategy={entry} />
            <Advanced label="Canonical JSON">
              <pre className="max-h-64 overflow-auto font-mono text-xs break-all whitespace-pre-wrap">{entry.canonical}</pre>
            </Advanced>
          </div>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-2 border-t border-line p-5 sm:px-6">
        <Button variant="secondary" onClick={() => setOpen((value) => !value)} aria-expanded={open} data-testid="discover-inspect">
          {open ? "Hide details" : "Inspect"}
        </Button>
        {availability.canReview ? (
          <ButtonLink href={`/strategies?template=${template.profile}#create`} data-testid="discover-adopt">
            {availability.canSign ? "Adopt" : "Review the transaction"} <IconArrowRight size={16} />
          </ButtonLink>
        ) : (
          <span className="inline-flex h-11 items-center text-sm text-muted" data-testid="discover-adopt-off">
            {STRATEGY_AVAILABILITY_LABEL[availability.status]}: adoption is not offered in this build
          </span>
        )}
      </div>
    </Card>
  );
}
