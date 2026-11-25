import { CONTEXT_INPUTS } from './context.js'
import { Op, hashNetlist, hashPolicySpec, toHex, validatePolicySpec, type Hex, type PolicySpec } from './spec.js'

export interface CompiledPolicy {
  configHash: Hex
  netlist: Hex
  netlistHash: Hex
  nIn: number
  nOut: number
  nState: number
  gateCount: number
}

const firstGate = 2 + CONTEXT_INPUTS
const fresh = 2 + 4
const cash = 2 + 19

class NandBuilder {
  private readonly gates: [number, number][] = []
  private readonly signals = new Map<string, number>()

  private nand(a: number, b: number): number {
    if (a === 0 || b === 0) return 1
    if (a === 1 && b === 1) return 0
    const key = a <= b ? `${a},${b}` : `${b},${a}`
    const found = this.signals.get(key)
    if (found !== undefined) return found
    const signal = firstGate + this.gates.length
    this.gates.push([a, b])
    this.signals.set(key, signal)
    return signal
  }

  not(a: number): number {
    return this.nand(a, a)
  }

  and(a: number, b: number): number {
    if (a === 1 || a === b) return b
    if (b === 1) return a
    return this.not(this.nand(a, b))
  }

  or(a: number, b: number): number {
    if (a === 0 || a === b) return b
    if (b === 0) return a
    return this.nand(this.not(a), this.not(b))
  }

  /** With the next more significant bit, the lower bits matter only if the high bits tie. */
  atMost(maxLtvBps: number): number {
    let lowerAtMost = 1
    for (let bit = 0; bit < 14; bit++) {
      const inputIsZero = this.not(2 + 5 + bit)
      lowerAtMost = (maxLtvBps & (1 << bit)) !== 0
        ? this.or(inputIsZero, lowerAtMost)
        : this.and(inputIsZero, lowerAtMost)
    }
    return lowerAtMost
  }

  matchesOp(op: Op): number {
    let same = 1
    for (let bit = 0; bit < 4; bit++) {
      const input = 2 + bit
      same = this.and(same, (op & (1 << bit)) !== 0 ? input : this.not(input))
    }
    return same
  }

  serialize(output: number): Uint8Array {
    // TAP takes its outputs from the final gates. Materialize a constant or reused signal here.
    if (output !== firstGate + this.gates.length - 1 || this.gates.length === 0) {
      const inverted = firstGate + this.gates.length
      this.gates.push([output, output], [inverted, inverted])
    }
    const bytes = new Uint8Array(7 * this.gates.length)
    for (const [index, [a, b]] of this.gates.entries()) {
      const offset = index * 7
      bytes.set([0, a >>> 16, a >>> 8, a, b >>> 16, b >>> 8, b], offset)
    }
    return bytes
  }
}

/** Compiles literal thresholds and permissions into a stateless, NAND-only TAP-02 netlist. */
export function compilePolicy(value: PolicySpec): CompiledPolicy {
  const spec = validatePolicySpec(value)
  const builder = new NandBuilder()
  let allow = builder.and(fresh, builder.atMost(spec.params.maxLtvBps))
  if (spec.kind === 'MARKET' && spec.params.requireCashReserve) {
    allow = builder.and(allow, builder.or(builder.not(builder.matchesOp(Op.BORROW)), cash))
  }
  if (spec.kind === 'ACCOUNT') {
    let allowed = 0
    for (const op of spec.params.allowedOps) allowed = builder.or(allowed, builder.matchesOp(op))
    allow = builder.and(allow, allowed)
  }
  const bytes = builder.serialize(allow)
  const netlist = toHex(bytes)
  return {configHash: hashPolicySpec(spec), netlist, netlistHash: hashNetlist(netlist),
    nIn: CONTEXT_INPUTS, nOut: 1, nState: 0, gateCount: bytes.length / 7}
}
