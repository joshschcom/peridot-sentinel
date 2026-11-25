import { Advanced, Badge, ExampleTag, Mono } from "@/components/ui/core";
import { IconCheck } from "@/components/ui/icons";
import { TARGET_KIND } from "@/lib/chains";
import { DEV_PROCESSOR_LABEL, describePolicy } from "@/lib/policy";
import type { PolicyRecord } from "@/services/types";

const PROCESSOR_LABEL = {
  official: "TapeOut processor",
  "development-reference": DEV_PROCESSOR_LABEL,
  "self-deployed-reference": "Self-deployed reference processor — not the official TapeOut deployment",
} as const;

/** Readable rules first; circuit identity (hashes, gate count, registration) behind "Advanced". */
export function PolicyRules({ record }: { record: PolicyRecord }) {
  if (!record.identified) {
    return (
      <p className="rounded-control border border-line bg-subtle p-3.5 text-sm text-muted">
        <span className="font-medium text-fg">Rules unavailable.</span> The registry stores only hashes for this policy, and no known rule set compiles to both of them. The circuit identity below is what is enforced.
      </p>
    );
  }
  return (
    <ul className="space-y-2.5">
      {describePolicy(record.spec).map((rule) => (
        <li key={rule} className="flex gap-3 text-sm">
          <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-raised">
            <IconCheck size={12} strokeWidth={2.6} />
          </span>
          {rule}
        </li>
      ))}
    </ul>
  );
}

export function PolicyIdentity({ record, open = false }: { record: PolicyRecord; open?: boolean }) {
  const compiled = record.compiled;
  const body = (
    <dl className="space-y-2.5">
      {record.identified ? (
        <Line label="Template">
          <Mono>{record.spec.templateId}</Mono> · schema <Mono>{record.spec.schema}</Mono>
        </Line>
      ) : null}
      {compiled.status === "ok" ? (
        <>
          <Line label="Circuit">
            {compiled.value.nIn} inputs · {compiled.value.nOut} output · {compiled.value.nState} state bits · {compiled.value.gateCount} NAND gates
          </Line>
          <Line label="Config hash">
            <Mono>{compiled.value.configHash}</Mono>
          </Line>
          <Line label="Netlist hash">
            <Mono>{compiled.value.netlistHash}</Mono>
          </Line>
        </>
      ) : (
        <Line label="Circuit">
          <span className="text-faint">Unavailable: {compiled.reason}</span>
        </Line>
      )}
      {record.registration.status === "ok" ? (
        <>
          <Line label="Policy ID">
            <Mono>{record.registration.value.policyId}</Mono>
          </Line>
          <Line label="Processor">
            <Mono>{record.registration.value.processor}</Mono> · circuit #{record.registration.value.circuitId.toString()}
            <div className="mt-1">
              <Badge tone={record.registration.value.processorKind === "official" ? "success" : "warning"}>{PROCESSOR_LABEL[record.registration.value.processorKind]}</Badge>
            </div>
          </Line>
        </>
      ) : (
        <Line label="On-chain registration">
          <span className="text-faint">Unavailable: {record.registration.reason}</span>
        </Line>
      )}
      {record.identified ? <p className="text-xs text-faint">Hashes and gate count are computed in your browser by the Peridot circuit compiler from the rules above{record.registration.status === "ok" ? " and equal the registry entry" : ""}. They are deterministic.</p> : null}
    </dl>
  );
  if (open) return body;
  return <Advanced label="Circuit identity">{body}</Advanced>;
}

function Line({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="num mt-0.5 text-sm break-words">{children}</dd>
    </div>
  );
}

export function SourceTag({ source }: { source: "fixture" | "chain" }) {
  return source === "fixture" ? <ExampleTag /> : <Badge tone={TARGET_KIND === "local" ? "warning" : "success"}>{TARGET_KIND === "local" ? "Local chain" : "Live"}</Badge>;
}

/** Cap as text, or a dash when the policy's rules are not known. Never shows a placeholder number. */
export function capText(record: PolicyRecord): string {
  return record.identified ? `${record.spec.params.maxLtvBps / 100}%` : "—";
}
