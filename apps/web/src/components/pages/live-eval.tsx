"use client";
/**
 * Native TapeOut evidence: evaluates a circuit that is published on X Layer mainnet, live, from this browser.
 * Read-only eth_calls through the public RPC. Until Peridot's own circuits are published on mainnet, the example
 * is the existing public circuit recorded in evidence/a1/mainnet-reads.json, and it is labelled as not Peridot's.
 */
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import type { Hex } from "viem";
import { Badge, Button, Card, CardHeader, DefinitionRow, Mono, Notice, Skeleton } from "@/components/ui/core";
import { IconAlert, IconArrowUpRight } from "@/components/ui/icons";
import { explorerAddressUrl, xLayerMainnet } from "@/lib/chains";
import { EVIDENCE } from "@/lib/evidence";
import { evalLive, readLiveCircuit } from "@/services/chain/mainnet-eval";
import type { Address } from "@/services/types";

/**
 * Peridot's own circuits (DECISIONS D16). `id` stays null until a circuit is actually published on chain 196; a
 * simulated ID from a fork must never be written here.
 */
const PERIDOT_MAINNET_CIRCUITS: Array<{ name: string; id: string | null }> = [
  { name: "Market Policy V1", id: null },
  { name: "Sentinel Policy V1", id: null },
  { name: "Expanded Sentinel Policy V2 (execution)", id: null },
];

const hexByte = (value: number): Hex => `0x${value.toString(16).padStart(2, "0")}`;

export function LiveMainnetEval() {
  const sample = EVIDENCE.publicSample;
  const [bits, setBits] = useState<boolean[]>([true, true]);
  const processor = sample.status === "ok" ? (sample.value.processor as Address) : null;
  const circuitId = sample.status === "ok" && /^\d+$/.test(sample.value.circuitId) ? BigInt(sample.value.circuitId) : null;
  const live = useQuery({
    queryKey: ["mainnet-eval", processor, circuitId?.toString()],
    queryFn: async () => {
      const circuit = await readLiveCircuit(processor!, circuitId!);
      // Identity first, evaluation second: if the chain does not hold the recorded circuit (other netlist or other
      // dimensions), nothing is evaluated and nothing is shown as a result.
      const expected = sample.status === "ok" ? sample.value : null;
      if (!expected || circuit.netlistHash.toLowerCase() !== expected.netlistHash.toLowerCase()) throw new Error("The netlist on chain does not match the recorded circuit, so it was not evaluated");
      if (String(circuit.dimensions.nIn) !== expected.dimensions.nIn || String(circuit.dimensions.nOut) !== expected.dimensions.nOut || String(circuit.dimensions.nState) !== expected.dimensions.nState) throw new Error("The circuit's dimensions on chain differ from the recorded ones, so it was not evaluated");
      // Small circuits get their whole truth table, read at one block. Larger ones are evaluated per chosen input.
      const inputs = circuit.dimensions.nIn <= 3 ? Array.from({ length: 2 ** circuit.dimensions.nIn }, (_, value) => hexByte(value)) : [];
      const outputs = await Promise.all(inputs.map((input) => evalLive(processor!, circuitId!, input, circuit.block)));
      return { circuit, table: inputs.map((input, index) => ({ input, output: outputs[index]! })), readAt: new Date().toISOString() };
    },
    enabled: processor !== null && circuitId !== null,
    staleTime: 60_000,
    retry: 1,
  });
  if (sample.status !== "ok" || !processor || circuitId === null) return null;

  const data = live.data;
  const nIn = data?.circuit.dimensions.nIn ?? 0;
  const chosen = bits.slice(0, nIn).reduce((value, bit, index) => value | (bit ? 1 << index : 0), 0);
  const row = data?.table.find((entry) => entry.input === hexByte(chosen)) ?? null;
  const recorded = (input: Hex) => sample.value.vectors.find((vector) => vector.input === input) ?? null;
  const hashMatches = data ? data.circuit.netlistHash.toLowerCase() === sample.value.netlistHash.toLowerCase() : null;
  const processorUrl = explorerAddressUrl(xLayerMainnet.id, processor);

  return (
    <Card as="section" data-testid="live-mainnet-eval" data-state={live.isPending ? "loading" : live.isError ? "error" : "ok"}>
      <CardHeader
        eyebrow="Live · X Layer mainnet (chain 196)"
        title="Evaluate a published TapeOut circuit now"
        description="Your browser asks the TapeOut processor on X Layer mainnet to evaluate a circuit, through the public RPC. These are read-only calls: no wallet, no transaction, no cost."
        action={<Badge tone={live.isError ? "danger" : data ? "success" : "neutral"}>{live.isError ? "Unavailable" : data ? "Live read" : "Reading…"}</Badge>}
      />
      {live.isPending ? (
        <Skeleton className="m-5 h-48" data-loading />
      ) : live.isError || !data ? (
        <div className="space-y-3 p-5 sm:p-6">
          <Notice tone="danger" icon={<IconAlert size={18} />} title="The live evaluation could not be read">
            {live.error instanceof Error ? live.error.message.split("\n")[0] : "The public mainnet RPC did not answer."} Nothing is shown in its place. The recorded read below is unaffected.
          </Notice>
          <Button size="sm" variant="secondary" onClick={() => void live.refetch()} disabled={live.isFetching}>
            {live.isFetching ? "Reading…" : "Try again"}
          </Button>
        </div>
      ) : (
        <div className="space-y-5 p-5 sm:p-6">
          <dl className="divide-y divide-line">
            <DefinitionRow label="Processor" mono>
              {processorUrl ? (
                <a href={processorUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 break-all underline underline-offset-4" data-testid="live-processor">
                  {processor} <IconArrowUpRight size={13} />
                </a>
              ) : (
                processor
              )}
            </DefinitionRow>
            <DefinitionRow label="Circuit ID">
              <span data-testid="live-circuit-id">#{data.circuit.circuitId.toString()}</span> · {data.circuit.dimensions.nIn} inputs · {data.circuit.dimensions.nOut} output · {data.circuit.dimensions.nState} state bits · {data.circuit.dimensions.gates} gates
            </DefinitionRow>
            <DefinitionRow label="Read at block">
              <span className="num" data-testid="live-block">{Number(data.circuit.block).toLocaleString("en-US")}</span> · chain {data.circuit.chainId} · {data.circuit.codeBytes.toLocaleString("en-US")} bytes of code at the processor
            </DefinitionRow>
            <DefinitionRow label="Netlist hash" mono>
              <span className="break-all">{data.circuit.netlistHash}</span>
              <span className={`mt-1 block font-sans text-xs ${hashMatches ? "text-success" : "text-danger"}`} data-testid="live-netlist-match" data-match={String(hashMatches)}>
                {hashMatches ? "keccak256 of the netlist read just now equals the recorded hash. The circuit is evaluated only when it does." : "This differs from the recorded hash: the circuit on chain is not the one in the repository record."}
              </span>
            </DefinitionRow>
          </dl>

          {data.table.length > 0 ? (
            <div className="rounded-control border border-line p-4" data-testid="live-eval">
              <h3 className="text-sm font-medium">Choose the inputs</h3>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {Array.from({ length: nIn }, (_, index) => (
                  <button
                    key={index}
                    type="button"
                    aria-pressed={bits[index] ?? false}
                    onClick={() => setBits((current) => Array.from({ length: nIn }, (_, bit) => (bit === index ? !(current[bit] ?? false) : (current[bit] ?? false))))}
                    className={`num h-10 rounded-control border px-3.5 text-sm font-medium ${bits[index] ? "border-fg bg-inverse text-on-inverse" : "border-line-strong text-muted"}`}
                    data-testid={`live-input-${index}`}
                  >
                    input {index} = {bits[index] ? 1 : 0}
                  </button>
                ))}
              </div>
              <p className="num mt-4 text-sm" data-testid="live-result" data-input={hexByte(chosen)} data-output={row?.output ?? ""}>
                <span className="font-mono text-xs text-muted">
                  eval({data.circuit.circuitId.toString()}, {hexByte(chosen)})
                </span>{" "}
                returned <span className="font-mono font-semibold">{row?.output ?? "?"}</span>
                <span className="text-muted"> at block {Number(data.circuit.block).toLocaleString("en-US")}.</span>
              </p>
              <table className="num mt-4 w-full max-w-md text-left text-sm">
                <thead className="text-xs text-muted">
                  <tr className="border-b border-line">
                    <th scope="col" className="py-2 font-medium">Input</th>
                    <th scope="col" className="py-2 font-medium">Live result</th>
                    <th scope="col" className="py-2 font-medium">Recorded reference</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line font-mono text-xs">
                  {data.table.map((entry) => {
                    const reference = recorded(entry.input);
                    return (
                      <tr key={entry.input} data-live-row={entry.input} data-output={entry.output} className={entry.input === hexByte(chosen) ? "bg-raised" : undefined}>
                        <td className="py-2 pl-1">{entry.input}</td>
                        <td className="py-2">{entry.output}</td>
                        <td className="py-2">
                          {reference ? (
                            <span className={reference.reference === entry.output ? "text-success" : "text-danger"}>
                              {reference.reference} · {reference.reference === entry.output ? "matches" : "differs"}
                            </span>
                          ) : (
                            <span className="text-faint">not recorded</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <p className="mt-3 text-xs text-faint">Input bits are packed into one byte, input 0 in the lowest bit. The reference column is the TAP Python reference model's output, recorded in {sample.value.file}.</p>
            </div>
          ) : (
            <p className="text-sm text-muted">This circuit has more inputs than this page tabulates.</p>
          )}

          <Notice title="This is not a Peridot circuit">
            It is a circuit that already existed on the official TapeOut deployment, used here to show a real evaluation on mainnet. The fork evidence further down is a simulation and stays labelled as one: circuit IDs from a fork are never looked up on mainnet.
          </Notice>
          <div data-testid="peridot-mainnet-circuits">
            <h3 className="text-sm font-medium">Peridot circuits on X Layer mainnet</h3>
            <ul className="mt-2 divide-y divide-line rounded-control border border-line text-sm">
              {PERIDOT_MAINNET_CIRCUITS.map((circuit) => (
                <li key={circuit.name} className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2.5" data-published={String(circuit.id !== null)}>
                  <span>{circuit.name}</span>
                  <Badge tone="outline">{circuit.id === null ? "Not published · no mainnet ID" : `Circuit #${circuit.id}`}</Badge>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-faint">None of these has been published on mainnet. Each will be evaluated here, like the example above, once its publication transaction exists and its netlist hash has been checked.</p>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-xs text-faint">
            <Button size="sm" variant="secondary" onClick={() => void live.refetch()} disabled={live.isFetching} data-testid="live-refresh">
              {live.isFetching ? "Reading…" : "Read again"}
            </Button>
            <span>
              Read {new Date(data.readAt).toISOString().slice(11, 19)} UTC from <Mono>{xLayerMainnet.rpcUrls.default.http[0]}</Mono>
            </span>
          </div>
        </div>
      )}
    </Card>
  );
}
