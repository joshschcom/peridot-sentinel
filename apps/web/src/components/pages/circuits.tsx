"use client";
import { PolicyIdentity, PolicyRules } from "@/components/domain/policy-card";
import { Badge, Card, CardHeader, DefinitionRow, ExampleTag, Mono, PageHeader, Skeleton } from "@/components/ui/core";
import { IconArrowUpRight, IconCheck, IconX } from "@/components/ui/icons";
import { useRegisteredPolicies, useTemplates } from "@/hooks/use-data";
import { explorerTxUrl } from "@/lib/chains";
import { EVIDENCE, FORK_LABEL, PUBLIC_READ_LABEL } from "@/lib/evidence";
import { resolveManifest } from "@/lib/manifest";
import { DEV_PROCESSOR_LABEL } from "@/lib/policy";
import { RAW_MANIFESTS } from "@/generated/manifests";
import { services } from "@/services";

const LAYOUT = [
  { bits: "0–3", width: 4, name: "op", note: "Operation id, least significant bit first" },
  { bits: "4", width: 1, name: "oracleFresh", note: "Prices are fresh" },
  { bits: "5–18", width: 14, name: "postLtvBps", note: "Loan-to-value after the operation, 0–10000" },
  { bits: "19", width: 1, name: "cashOk", note: "Borrow leaves the cash reserve intact" },
];

export function Circuits() {
  const templates = useTemplates();
  const registered = useRegisteredPolicies();
  const fixture = services.policy.source === "fixture";
  const compiledHashes = new Set((templates.data ?? []).flatMap((template) => (template.sample.compiled.status === "ok" ? [template.sample.compiled.value.netlistHash] : [])));
  const local = resolveManifest(31337, RAW_MANIFESTS["31337"]);

  return (
    <div className="space-y-8">
      <PageHeader
        title="Circuits"
        description="Policies are small stateless circuits. The contracts build the inputs from their own accounting, ask the processor for one bit, and enforce it. This page shows the templates and exactly what has been verified, and where."
      />

      {/* Context layout */}
      <Card as="section">
        <CardHeader title="What a policy circuit sees" description="Twenty input wires packed into three bytes by the market contract. Nobody, including the market owner or an agent, can supply these values." />
        <div className="space-y-5 p-5 sm:p-6">
          <div className="flex h-12 overflow-hidden rounded-control border border-line-strong text-xs font-medium" aria-hidden="true">
            {LAYOUT.map((field, index) => (
              <div key={field.name} className={`grid min-w-0 place-items-center border-r border-line-strong px-1 last:border-r-0 ${index % 2 === 0 ? "bg-raised" : "bg-surface"}`} style={{ flexGrow: field.width, flexBasis: 0, minWidth: "2.25rem" }}>
                <span className="truncate">{field.width > 1 ? field.name : field.name === "cashOk" ? "cash" : "fresh"}</span>
              </div>
            ))}
          </div>
          <dl className="divide-y divide-line">
            {LAYOUT.map((field) => (
              <div key={field.name} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 py-2.5 text-sm">
                <dt>
                  <Mono>{field.name}</Mono> <span className="num text-xs text-faint">wire {field.bits}</span>
                </dt>
                <dd className="text-muted">{field.note}</dd>
              </div>
            ))}
          </dl>
          <p className="text-sm text-muted">
            One output bit: <Mono>01</Mono> allow, <Mono>00</Mono> deny. Example: a borrow at 50% with both flags set encodes as <Mono>0x12710a</Mono>. Thresholds and allowed actions are constants inside each circuit, so changing a rule means a new circuit with a new hash.
          </p>
        </div>
      </Card>

      {/* Templates */}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold tracking-tight">Templates</h2>
        {templates.isPending ? (
          <Skeleton className="h-64" data-loading />
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {(templates.data ?? []).map((template) => (
              <Card as="article" key={template.templateId}>
                <CardHeader eyebrow={template.kind === "MARKET" ? "Market policy" : "Account policy"} title={template.title} description={template.summary} action={<Badge tone="outline">Sample</Badge>} />
                <div className="space-y-4 p-5 sm:p-6">
                  <PolicyRules record={template.sample} />
                  <PolicyIdentity record={template.sample} />
                </div>
              </Card>
            ))}
          </div>
        )}
      </section>

      {/* Evidence */}
      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Evidence</h2>
          <p className="mt-1 max-w-2xl text-sm text-muted">Three separate environments. Only the first is publicly verifiable. None of this is example data.</p>
        </div>

        <Card as="article">
          <CardHeader eyebrow="1 · Public X Layer mainnet" title={PUBLIC_READ_LABEL} description="A circuit that already existed on the official TapeOut deployment. Read with eth_call only: no transaction was sent." action={<Badge tone="success">Public</Badge>} />
          {EVIDENCE.publicSample.status === "ok" ? (
            <PublicSample />
          ) : (
            <p className="p-5 text-sm text-faint sm:p-6">Unavailable: {EVIDENCE.publicSample.reason}</p>
          )}
        </Card>

        <Card as="article">
          <CardHeader eyebrow="2 · Mainnet fork" title="Peridot policies on the real TapeOut processor code" description="Both sample policies were fabricated and evaluated on a local fork of X Layer mainnet." action={<Badge tone="warning">Fork simulation</Badge>} />
          {EVIDENCE.forkPolicies.status === "ok" ? (
            <div className="space-y-4 p-5 sm:p-6">
              <p className="text-xs font-medium text-warning">{FORK_LABEL}</p>
              <dl className="divide-y divide-line">
                <DefinitionRow label="Forked from">
                  X Layer mainnet ({EVIDENCE.forkPolicies.value.sourceChainId}), block {Number(EVIDENCE.forkPolicies.value.sourceBlock).toLocaleString("en-US")}
                </DefinitionRow>
                <DefinitionRow label="Processor" mono>
                  {EVIDENCE.forkPolicies.value.processor}
                </DefinitionRow>
              </dl>
              <ul className="grid gap-3 md:grid-cols-2">
                {EVIDENCE.forkPolicies.value.policies.map((policy) => {
                  const matches = compiledHashes.has(policy.netlistHash as `0x${string}`);
                  return (
                    <li key={policy.circuitId} className="rounded-control border border-line p-4 text-sm">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium">{policy.kind === "MARKET" ? "Market policy" : "Account policy"}</span>
                        <Badge tone="outline">Fork-only circuit #{policy.circuitId}</Badge>
                      </div>
                      <dl className="num mt-3 space-y-1.5 text-[0.8125rem] text-muted">
                        <div>{policy.gates} NAND gates · fabrication gas {Number(policy.fabricationGas).toLocaleString("en-US")}</div>
                        <div>{policy.vectors} test vectors evaluated on the fork</div>
                        <div className="break-all">
                          netlist <Mono className="text-xs">{policy.netlistHash}</Mono>
                        </div>
                      </dl>
                      {templates.data ? (
                        <p className={`mt-3 flex items-center gap-1.5 text-[0.8125rem] font-medium ${matches ? "text-success" : "text-danger"}`}>
                          {matches ? <IconCheck size={14} strokeWidth={2.4} /> : <IconX size={14} strokeWidth={2.4} />}
                          {matches ? "Netlist hash equals the circuit compiled in this browser" : "Netlist hash differs from the circuit compiled in this browser"}
                        </p>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
              <p className="text-xs text-faint">Source: {EVIDENCE.forkPolicies.value.file}. The settlement run (an allowed borrow and one rejection by each policy) is listed under Sentinel → Activity.</p>
            </div>
          ) : (
            <p className="p-5 text-sm text-faint sm:p-6">Unavailable: {EVIDENCE.forkPolicies.reason}</p>
          )}
        </Card>

        <Card as="article">
          <CardHeader eyebrow="3 · Local development chain" title="Development reference processor" description="The unforked local stack uses a test interpreter so the full product can run without the sponsor contracts." action={<Badge tone="neutral">Local</Badge>} />
          {local.state === "deployed" && local.manifest.tapeout.mode === "development-reference" ? (
            <div className="space-y-4 p-5 sm:p-6">
              <p className="text-xs font-medium text-warning">{DEV_PROCESSOR_LABEL}</p>
              <dl className="divide-y divide-line">
                <DefinitionRow label="Chain">Anvil, 31337 (local profile)</DefinitionRow>
                <DefinitionRow label="Processor" mono>
                  {local.manifest.tapeout.processor ?? "none"}
                </DefinitionRow>
                {local.manifest.tapeout.circuits.map((circuit) => (
                  <DefinitionRow key={circuit.policyId} label={`${circuit.kind === "MARKET" ? "Market" : "Account"} policy · circuit #${circuit.circuitId}`} mono>
                    {circuit.policyId}
                  </DefinitionRow>
                ))}
              </dl>
              <p className="text-xs text-faint">Source: packages/chain-config/deployments/31337.json. Addresses exist only on a developer's machine.</p>
            </div>
          ) : (
            <p className="p-5 text-sm text-faint sm:p-6">No local deployment manifest is bundled with this build.</p>
          )}
        </Card>
      </section>

      {/* Registry */}
      <section className="space-y-4">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold tracking-tight">Policies in use</h2>
          {fixture ? <ExampleTag /> : <Badge tone="success">Live</Badge>}
        </div>
        {registered.isPending ? (
          <Skeleton className="h-40" data-loading />
        ) : registered.data?.status === "ok" ? (
          <Card>
            <ul className="divide-y divide-line">
              {registered.data.value.map((record, index) => (
                <li key={index} className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 p-4 sm:px-6">
                  <div className="min-w-0">
                    <div className="text-sm font-medium">
                      {record.spec.label ?? record.spec.templateId} <span className="font-normal text-muted">· {record.spec.kind === "MARKET" ? "market" : "account"} · cap {record.spec.params.maxLtvBps / 100}%</span>
                    </div>
                    <div className="num mt-0.5 text-xs text-faint">
                      {record.compiled.status === "ok" ? (
                        <>
                          {record.compiled.value.gateCount} gates · config <Mono className="text-xs">{record.compiled.value.configHash.slice(0, 18)}…</Mono>
                        </>
                      ) : (
                        "Does not compile"
                      )}
                    </div>
                  </div>
                  <span className="text-xs text-faint">{record.registration.status === "ok" ? `Circuit #${record.registration.value.circuitId.toString()}` : "Not registered on chain"}</span>
                </li>
              ))}
            </ul>
          </Card>
        ) : (
          <p className="text-sm text-faint">Unavailable: {registered.data?.status === "unavailable" ? registered.data.reason : "could not be loaded"}</p>
        )}
        <p className="text-xs text-faint">Publishing, importing and paid circuit listings are not implemented. Owning a processor NFT gives no control over any Peridot market or account.</p>
      </section>
    </div>
  );
}

function PublicSample() {
  if (EVIDENCE.publicSample.status !== "ok") return null;
  const sample = EVIDENCE.publicSample.value;
  const fabricationUrl = sample.fabricationTx ? explorerTxUrl(196, sample.fabricationTx) : null;
  return (
    <div className="space-y-4 p-5 sm:p-6">
      <dl className="divide-y divide-line">
        <DefinitionRow label="Processor" mono>
          {sample.processor}
        </DefinitionRow>
        <DefinitionRow label="Circuit">
          #{sample.circuitId} · {sample.dimensions.nIn} inputs · {sample.dimensions.nOut} output · {sample.dimensions.nState} state bits · {sample.dimensions.gates} gates
        </DefinitionRow>
        <DefinitionRow label="Read at block">{Number(sample.block).toLocaleString("en-US")} (chain 196)</DefinitionRow>
        <DefinitionRow label="Netlist hash" mono>
          {sample.netlistHash}
        </DefinitionRow>
        {fabricationUrl ? (
          <DefinitionRow label="Original fabrication">
            <a href={fabricationUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium underline underline-offset-4">
              View transaction <IconArrowUpRight size={13} />
            </a>
          </DefinitionRow>
        ) : null}
      </dl>
      <div className="overflow-x-auto rounded-control border border-line">
        <table className="num w-full min-w-[26rem] text-left text-sm">
          <caption className="sr-only">Inputs evaluated on chain compared with the TAP reference model</caption>
          <thead className="text-xs text-muted">
            <tr className="border-b border-line">
              <th scope="col" className="px-3.5 py-2.5 font-medium">Input</th>
              <th scope="col" className="px-3.5 py-2.5 font-medium">On-chain output</th>
              <th scope="col" className="px-3.5 py-2.5 font-medium">Reference</th>
              <th scope="col" className="px-3.5 py-2.5 font-medium">Gas estimate</th>
              <th scope="col" className="px-3.5 py-2.5 font-medium">Match</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line font-mono text-[0.8125rem]">
            {sample.vectors.map((vector, index) => (
              <tr key={index}>
                <td className="px-3.5 py-2">{vector.input === "0x" ? "0x (empty)" : vector.input}</td>
                <td className="px-3.5 py-2">{vector.output}</td>
                <td className="px-3.5 py-2">{vector.reference}</td>
                <td className="px-3.5 py-2">{Number(vector.gas).toLocaleString("en-US")}</td>
                <td className="px-3.5 py-2">{vector.matches ? <IconCheck size={15} className="text-success" strokeWidth={2.4} /> : <IconX size={15} className="text-danger" strokeWidth={2.4} />}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-sm text-muted">
        This is <span className="font-medium text-fg">not a Peridot policy circuit</span>, and no Peridot policy has been fabricated on public mainnet. The TapeOut factory reports <Mono>isSealed = {sample.factory.sealed ?? "unknown"}</Mono>, so its implementation can still be upgraded by its owner: an external trust dependency.
      </p>
      <p className="text-xs text-faint">Source: {sample.file}</p>
    </div>
  );
}
