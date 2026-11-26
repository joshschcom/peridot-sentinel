"use client";
/**
 * Peridot's own policy circuits on the TapeOut processor on X Layer mainnet (chain 196).
 *
 * Which circuits are published, and under which IDs, comes from ONE file: packages/chain-config/expansion/
 * tapeout-196.json (src/lib/tapeout.ts). A circuit without an ID and a publication receipt there is shown as
 * "Not yet published" and nothing is read for it. A published circuit is verified first (receipt, TapedOut event,
 * dimensions, netlist hash) and only then evaluated, with every read of one result pinned to one block.
 *
 * Wording: this is a NATIVE EVALUATION, read-only. It is evidence, not enforcement. The word "enforced" is kept for
 * the account and market contract paths.
 */
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Badge, Button, Card, CardHeader, DefinitionRow, Mono, Notice, Skeleton } from "@/components/ui/core";
import { IconAlert, IconArrowUpRight, IconCheck, IconX } from "@/components/ui/icons";
import { explorerAddressUrl, explorerTxUrl, xLayerMainnet } from "@/lib/chains";
import { OP_LABEL, Op, type OpId } from "@/lib/policy";
import { EXECUTION_CHECKS, FORK_REHEARSAL_LABEL, NATIVE_EVAL_LABEL, type PeridotCircuit, REHEARSAL, TAPEOUT, type TapeoutConfig, encodeExecutionV1, encodeLendingV1 } from "@/lib/tapeout";
import { evaluatePublished, readProcessorPresence } from "@/services/chain/mainnet-eval";
import type { Address } from "@/services/types";

const num = (value: bigint | number) => Number(value).toLocaleString("en-US");
const KIND_LABEL = { MARKET: "Market policy", ACCOUNT: "Account policy", EXECUTION: "Execution policy (swap)" } as const;

export function PeridotMainnetCircuits() {
  if (TAPEOUT.status !== "ok") {
    return (
      <Notice tone="warning" icon={<IconAlert size={18} />} title="Peridot's mainnet circuit list is not in this build" data-testid="peridot-mainnet-circuits">
        {TAPEOUT.reason}. Nothing is shown in its place.
      </Notice>
    );
  }
  const config = TAPEOUT.value;
  const published = config.circuits.filter((circuit) => circuit.publication.state === "published").length;
  const processorUrl = explorerAddressUrl(xLayerMainnet.id, config.processor);
  return (
    <Card as="section" id="peridot-circuits" className="scroll-mt-28" data-testid="peridot-mainnet-circuits" data-published={published} data-total={config.circuits.length}>
      <CardHeader
        eyebrow="Peridot circuits · X Layer mainnet (chain 196)"
        title={NATIVE_EVAL_LABEL}
        description="Peridot's own policy circuits on the public TapeOut processor. Once a circuit is published, your browser asks the processor to evaluate it for inputs you choose. No wallet, no transaction, no cost."
        action={<Badge tone={published > 0 ? "success" : "outline"}>{published === 0 ? "Not yet published" : `${published} of ${config.circuits.length} published`}</Badge>}
      />
      <div className="space-y-5 p-5 sm:p-6">
        <Notice title="Evidence, not enforcement" data-testid="native-eval-scope">
          A native evaluation shows that a circuit exists on the processor and what it answers for a given input. It moves no funds and authorises nothing: no account or market on mainnet is bound to these circuits. Policies are enforced only inside the account and market contracts, which run on X Layer testnet today with a development reference processor.
        </Notice>
        <dl className="divide-y divide-line">
          <DefinitionRow stack label="Processor (TapeOut CPU 410)" mono>
            {processorUrl ? (
              <a href={processorUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 break-all underline underline-offset-4" data-testid="peridot-processor">
                {config.processor} <IconArrowUpRight size={13} />
              </a>
            ) : (
              config.processor
            )}
          </DefinitionRow>
          <ProcessorPresence processor={config.processor} />
        </dl>
        <ul className="space-y-4">
          {config.circuits.map((circuit) => (
            <li key={circuit.netlistHash}>
              <CircuitPanel circuit={circuit} config={config} />
            </li>
          ))}
        </ul>
        <p className="text-xs text-faint">
          IDs and publication receipts are read from <Mono>{config.file}</Mono> and nowhere else. Circuit IDs from a fork rehearsal are never looked up on mainnet.
        </p>
      </div>
    </Card>
  );
}

function ProcessorPresence({ processor }: { processor: string }) {
  const presence = useQuery({ queryKey: ["tapeout-processor", processor], queryFn: () => readProcessorPresence(processor as Address), staleTime: 60_000, retry: 1 });
  return (
    <DefinitionRow stack label="Processor on chain">
      <span data-testid="peridot-processor-presence" data-state={presence.isPending ? "loading" : presence.isError ? "error" : presence.data.codeBytes > 0 ? "ok" : "no-code"}>
        {presence.isPending ? (
          "Reading…"
        ) : presence.isError ? (
          <span className="text-danger">Could not be read from the public RPC. This says nothing about the circuits.</span>
        ) : presence.data.codeBytes > 0 ? (
          <>
            {num(presence.data.codeBytes)} bytes of contract code at block <span className="num">{num(presence.data.block.number)}</span>
          </>
        ) : (
          <span className="text-danger">No contract code at this address at block {num(presence.data.block.number)}</span>
        )}
      </span>
    </DefinitionRow>
  );
}

function CircuitPanel({ circuit, config }: { circuit: PeridotCircuit; config: TapeoutConfig }) {
  const state = circuit.publication.state;
  const rehearsed = REHEARSAL.circuits.find((entry) => entry.netlistHash === circuit.netlistHash) ?? null;
  return (
    <article className="rounded-control border border-line" data-circuit={circuit.kind} data-publication={state} data-circuit-id={circuit.publication.state === "published" ? circuit.publication.id.toString() : ""}>
      <div className="flex flex-wrap items-start justify-between gap-3 p-4">
        <div className="min-w-0">
          <p className="eyebrow">{KIND_LABEL[circuit.kind]} · Peridot</p>
          <h3 className="mt-1 text-sm font-semibold">{circuit.name}</h3>
          <p className="mt-1 text-xs text-faint">
            20 inputs · 1 output · {circuit.gates} NAND gates · netlist hash <Mono>{circuit.netlistHash}</Mono>
          </p>
        </div>
        <Badge tone={state === "published" ? "success" : state === "incomplete" ? "warning" : "outline"}>{circuit.publication.state === "published" ? `Published · circuit #${circuit.publication.id}` : "Not yet published"}</Badge>
      </div>
      {circuit.publication.state === "published" ? (
        <PublishedCircuit circuit={circuit} id={circuit.publication.id} receipt={circuit.publication.receipt} processor={config.processor} />
      ) : (
        <div className="space-y-3 border-t border-line p-4 text-sm">
          <p className="text-muted" data-testid="not-published">
            {circuit.publication.state === "incomplete"
              ? `Treated as not published: ${circuit.publication.reason}. Nothing is evaluated.`
              : "This circuit has no public ID on mainnet yet, so there is nothing to evaluate. When its publication transaction exists, this panel verifies it and lets you evaluate the circuit."}
          </p>
          {rehearsed && rehearsed.vectors.length > 0 ? (
            <details className="rounded-control border border-line">
              <summary className="flex min-h-11 cursor-pointer items-center px-3.5 text-sm font-medium text-muted hover:text-fg">Rehearsed on a mainnet fork: {rehearsed.vectors.length} input vectors</summary>
              <div className="border-t border-line p-3.5">
                <p className="text-xs text-warning">{FORK_REHEARSAL_LABEL}. These results come from a local fork of chain 196 running the real processor code. They are not mainnet evaluations.</p>
                <table className="num mt-3 w-full text-left text-xs">
                  <thead className="text-faint">
                    <tr className="border-b border-line">
                      <th scope="col" className="py-1.5 font-medium">Scenario</th>
                      <th scope="col" className="py-1.5 font-medium">Input bytes</th>
                      <th scope="col" className="py-1.5 font-medium">Fork result</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {rehearsed.vectors.map((vector, index) => (
                      <tr key={index}>
                        <td className="py-1.5 pr-3">{describeContext(vector.context)}</td>
                        <td className="py-1.5 pr-3 font-mono">{vector.inputs}</td>
                        <td className="py-1.5 font-mono">
                          {vector.output} · {vector.output === "0x01" ? "allow" : "deny"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="mt-2 text-xs text-faint">Source: {REHEARSAL.file}</p>
              </div>
            </details>
          ) : null}
        </div>
      )}
    </article>
  );
}

function describeContext(context: Record<string, unknown>): string {
  if (typeof context.reason === "string") return `Malformed input: ${context.reason}`;
  if (typeof context.lossBps === "number") return `Swap, checks ${Number(context.checks).toString(2).padStart(4, "0")}, loss ${context.lossBps} bps`;
  const op = OP_LABEL[context.op as OpId] ?? `operation ${String(context.op)}`;
  return `${op}, LTV ${String(context.postLtvBps)} bps, price ${context.oracleFresh ? "fresh" : "stale"}, cash reserve ${context.cashOk ? "intact" : "not intact"}`;
}

/* ---------- a published circuit: scenario inputs and the native result ---------- */

const LENDING_OPS: OpId[] = [Op.BORROW, Op.SUPPLY, Op.REDEEM, Op.REPAY, Op.TRANSFER, Op.EXIT_COLLATERAL, Op.ENTER_COLLATERAL];

function PublishedCircuit({ circuit, id, receipt, processor }: { circuit: PeridotCircuit; id: bigint; receipt: `0x${string}`; processor: string }) {
  const execution = circuit.schema === "sentinel-execution-swap-v1";
  const [op, setOp] = useState<number>(Op.BORROW);
  const [fresh, setFresh] = useState(true);
  const [cash, setCash] = useState(true);
  const [ltvText, setLtvText] = useState(circuit.kind === "ACCOUNT" ? "5500" : "6500");
  const [checks, setChecks] = useState(15);
  const [lossText, setLossText] = useState("100");
  const whole = (text: string) => (/^\d{1,6}$/.test(text.trim()) ? Number(text.trim()) : Number.NaN);
  const encoded = execution ? encodeExecutionV1({ checks, lossBps: whole(lossText) }) : encodeLendingV1({ op, oracleFresh: fresh, postLtvBps: whole(ltvText), cashOk: cash });
  const input = encoded.status === "ok" ? encoded.value : null;
  // The query key holds the input, so changing any input starts a new evaluation at a newly pinned block.
  const result = useQuery({
    queryKey: ["native-eval", processor, id.toString(), receipt, input],
    queryFn: () => evaluatePublished(processor as Address, { id, receipt, netlistHash: circuit.netlistHash, gates: circuit.gates }, input!),
    enabled: input !== null,
    staleTime: 0,
    gcTime: 0,
    retry: 1,
  });
  const receiptUrl = explorerTxUrl(xLayerMainnet.id, receipt);
  const data = result.data;
  const field = "mt-1.5 h-11 w-full rounded-control border border-line-strong bg-bg px-3 text-sm";
  const check = (label: string, checked: boolean, onChange: (value: boolean) => void, testid: string) => (
    <label className="flex min-h-11 items-center gap-2.5 text-sm">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="size-4" data-testid={testid} />
      {label}
    </label>
  );
  return (
    <div className="space-y-4 border-t border-line p-4" data-testid="native-eval" data-kind={circuit.kind}>
      <p className="text-xs text-faint">
        Publication transaction:{" "}
        {receiptUrl ? (
          <a href={receiptUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-mono break-all text-fg underline underline-offset-4" data-testid="publication-link">
            {receipt} <IconArrowUpRight size={12} />
          </a>
        ) : (
          <Mono>{receipt}</Mono>
        )}
      </p>
      <fieldset className="grid gap-x-5 gap-y-3 sm:grid-cols-2">
        <legend className="mb-2 text-sm font-medium">Scenario inputs</legend>
        {execution ? (
          <>
            <label className="block text-sm">
              Permitted loss against the oracle quote, in basis points (0 to 1023)
              <input inputMode="numeric" value={lossText} onChange={(event) => setLossText(event.target.value)} className={field} data-testid="native-loss" />
            </label>
            <div>
              {EXECUTION_CHECKS.map((label, bit) => (
                <div key={label}>{check(label, (checks & (1 << bit)) !== 0, (value) => setChecks((current) => (value ? current | (1 << bit) : current & ~(1 << bit))), `native-check-${bit}`)}</div>
              ))}
            </div>
          </>
        ) : (
          <>
            <label className="block text-sm">
              Loan-to-value after the operation, in basis points (6500 = 65%)
              <input inputMode="numeric" value={ltvText} onChange={(event) => setLtvText(event.target.value)} className={field} data-testid="native-ltv" />
            </label>
            <label className="block text-sm">
              Operation
              <select value={op} onChange={(event) => setOp(Number(event.target.value))} className={field} data-testid="native-op">
                {LENDING_OPS.map((value) => (
                  <option key={value} value={value}>
                    {OP_LABEL[value]}
                  </option>
                ))}
              </select>
            </label>
            {check("Prices are fresh", fresh, setFresh, "native-fresh")}
            {check("The cash reserve stays intact", cash, setCash, "native-cash")}
          </>
        )}
      </fieldset>
      <p className="text-xs text-faint">These inputs describe a scenario you choose. In a real transaction the contracts build them from their own accounting, and nobody can supply them.</p>

      <div aria-live="polite" data-testid="native-result" data-state={input === null ? "bad-input" : result.isPending ? "loading" : result.isError ? "rpc-error" : data?.state === "refused" ? "refused" : data?.decision.kind} data-input={input ?? ""} data-output={data?.state === "evaluated" ? data.output : ""} data-block={data ? data.block.number.toString() : ""}>
        {input === null ? (
          <Notice tone="warning" icon={<IconAlert size={18} />} title="These inputs cannot be encoded">
            {encoded.status === "unavailable" ? encoded.reason : null}. Nothing was evaluated.
          </Notice>
        ) : result.isPending ? (
          <Skeleton className="h-24" data-loading />
        ) : result.isError || !data ? (
          <Notice tone="danger" icon={<IconAlert size={18} />} title="The evaluation could not be read">
            {result.error instanceof Error ? result.error.message.split("\n")[0] : "The public mainnet RPC did not answer."} This is a read failure, not a decision by the circuit.
          </Notice>
        ) : data.state === "refused" ? (
          <Notice tone="danger" icon={<IconAlert size={18} />} title="Not evaluated: the publication could not be verified">
            {data.check.reason}. Checked at block {num(data.block.number)}. The circuit is evaluated only after its receipt, its event, its dimensions and its netlist hash all match.
          </Notice>
        ) : data.decision.kind === "invalid" ? (
          <Notice tone="danger" icon={<IconAlert size={18} />} title="The processor returned something that is not a decision">
            eval returned <Mono>{data.output}</Mono> at block {num(data.block.number)}. A policy circuit must answer exactly <Mono>0x00</Mono> or <Mono>0x01</Mono>, so this is shown as an error and not as “deny”.
          </Notice>
        ) : (
          <div className="rounded-control border border-line p-4">
            <p className="flex items-center gap-2 text-sm font-medium">
              {data.decision.kind === "allow" ? <IconCheck size={18} className="text-success" /> : <IconX size={18} className="text-danger" />}
              The circuit answers {data.decision.kind === "allow" ? "allow" : "deny"} for this scenario
            </p>
            <dl className="mt-3 divide-y divide-line">
              <DefinitionRow stack label="Call" mono>
                eval({data.circuitId.toString()}, {data.input}) → {data.output}
              </DefinitionRow>
              <DefinitionRow stack label="Read at block">
                <span className="num">{num(data.block.number)}</span> · chain {xLayerMainnet.id} · <Mono>{data.block.hash}</Mono>
              </DefinitionRow>
              <DefinitionRow stack label="Verified before evaluating">Publication receipt in block {num(data.publishedInBlock)}, TapedOut event for circuit #{data.circuitId.toString()}, 20 / 1 / 0 / {circuit.gates} dimensions, netlist hash</DefinitionRow>
              <DefinitionRow stack label="Calldata" mono>
                <span className="break-all">{data.calldata}</span>
              </DefinitionRow>
            </dl>
            <p className="mt-3 text-xs text-faint">
              {NATIVE_EVAL_LABEL}: every read of this result used that one block, through <Mono>{xLayerMainnet.rpcUrls.default.http[0]}</Mono>. It is an eth_call, so it has no transaction hash; anyone can repeat it at that block. It is not an authorisation and not enforcement.
            </p>
          </div>
        )}
      </div>
      <Button size="sm" variant="secondary" onClick={() => void result.refetch()} disabled={input === null || result.isFetching} data-testid="native-refresh">
        {result.isFetching ? "Reading…" : "Evaluate again at the latest block"}
      </Button>
    </div>
  );
}
