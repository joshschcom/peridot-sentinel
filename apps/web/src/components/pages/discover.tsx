"use client";
/**
 * Discover (DECISIONS D23): the curated strategy templates. Every card is one of the SDK's own templates, bound to
 * contracts deployed on X Layer testnet. There is no performance, yield, TVL, user count or creator earning on this
 * page, because none exists: the assets are test tokens and nobody has earned anything.
 * A label is derived from what this build lets a user do with the template (src/lib/strategy.ts), never typed in.
 */
import { useState } from "react";
import { StrategyBadge, TemplateFacts, TemplateIdentity, TemplateText } from "@/components/domain/strategy-bits";
import { STRATEGY_CONTEXT } from "@/lib/strategy-context";
import { Advanced, Badge, Button, ButtonLink, Card, PageHeader } from "@/components/ui/core";
import { IconArrowRight, IconArrowUpRight } from "@/components/ui/icons";
import { explorerTxUrl } from "@/lib/chains";
import { EVIDENCE } from "@/lib/evidence";
import { EXPANSION } from "@/lib/expansion";
import { shortHash } from "@/lib/format";
import { CURATED, type CheckedStrategy, STRATEGY_AVAILABILITY_LABEL, modeLabel, templateAvailability, templateFacts } from "@/lib/strategy";

/** Roadmap entries. They have no template, no parameters and no action: nothing here can be adopted. */
const PLANNED = [
  { name: "Vault deposits", body: "An ERC-4626 vault adapter is deployed on testnet with a mock vault and has been exercised by the contracts team. It has no strategy template and this app does not offer it." },
  { name: "Liquidity position lifecycle", body: "Opening, collecting and closing a concentrated-liquidity position exists as a prototype on a mainnet fork only. Nothing is deployed for it." },
  { name: "Peridot-hosted AI", body: "A strategy run by a model that Peridot operates. No hosted model exists; the two modes that work are rules and your own agent." },
] as const;

export function Discover() {
  return (
    <div className="space-y-6" data-testid="discover">
      <PageHeader
        eyebrow="Personal"
        title="Discover"
        description="Strategy templates you can inspect and adopt. Each one is bound to contracts that are deployed on X Layer testnet, and adopting it means you sign the grant yourself."
        actions={
          <ButtonLink href="/strategies#import" variant="secondary">
            Import a template
          </ButtonLink>
        }
      />
      <p className="max-w-3xl rounded-control border border-line bg-subtle p-3.5 text-sm text-muted" data-testid="discover-no-metrics">
        No returns, yields, TVL, user counts or creator earnings are shown here, because there are none. These strategies move valueless test tokens on a test network. What you can check instead is exactly what each one permits.
      </p>

      {CURATED.length === 0 ? <p className="text-sm text-muted">The curated templates are not available in this build.</p> : null}
      <ul className="grid gap-4 lg:grid-cols-2">
        {CURATED.map((entry) => (
          <TemplateCard key={entry.hash} entry={entry} />
        ))}
      </ul>

      <section aria-labelledby="discover-labels" className="rounded-card border border-line p-5 sm:p-6">
        <h2 id="discover-labels" className="text-base font-semibold tracking-tight">What the labels mean</h2>
        <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-3">
          <div>
            <dt><StrategyBadge status="available" /></dt>
            <dd className="mt-2 text-muted">You can review the exact transactions and sign them with your own wallet in this app, on X Layer testnet.</dd>
          </div>
          <div>
            <dt><StrategyBadge status="demonstration" /></dt>
            <dd className="mt-2 text-muted">The template is genuine and has run on testnet, but this app does not let you sign it. Where possible you can still review the transaction.</dd>
          </div>
          <div>
            <dt><StrategyBadge status="planned" /></dt>
            <dd className="mt-2 text-muted">On the roadmap. No template, nothing to adopt.</dd>
          </div>
        </dl>
      </section>

      <section aria-labelledby="discover-planned" data-testid="discover-planned">
        <h2 id="discover-planned" className="text-base font-semibold tracking-tight">Not available yet</h2>
        <ul className="mt-3 grid gap-3 md:grid-cols-3">
          {PLANNED.map((item) => (
            <li key={item.name} className="rounded-card border border-dashed border-line-strong p-5" data-planned={item.name}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-medium">{item.name}</h3>
                <StrategyBadge status="planned" />
              </div>
              <p className="mt-2 text-sm text-muted">{item.body}</p>
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
        <p className="text-xs text-faint">Budget and lifetime are the template's suggestions. You can lower them before you sign. Test tokens, mock prices{template.profile === "restricted-swap-v2" ? ", mock swap venue" : ""}.</p>
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
            . That is not a result for you.
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
