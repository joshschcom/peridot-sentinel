import { fromHex, toHex, type Hex } from './spec.js'

/** TAP-02 combinational NAND subset. Inputs follow processor zero extension and trailing-bit semantics. */
export function evaluateNetlist(netlist: Hex, nIn: number, nOut: number, inputs: Hex): Hex {
  if (!Number.isInteger(nIn) || nIn < 0 || nIn > 65_536 ||
      !Number.isInteger(nOut) || nOut < 1 || nOut > 65_536) {
    throw new RangeError('Invalid pin count')
  }
  // Bound parsing of externally supplied bytes. All v1 policies fit comfortably in this limit.
  const gateCount = (netlist.length - 2) / 14
  if (!Number.isInteger(gateCount) || gateCount < nOut || gateCount > 4096) {
    throw new RangeError('Incomplete NAND record, insufficient output gates, or gate limit exceeded')
  }
  const bytes = fromHex(netlist)
  const input = fromHex(inputs)
  const signals = new Uint8Array(2 + nIn + gateCount)
  signals[1] = 1
  for (let pin = 0; pin < nIn; pin++) signals[2 + pin] = ((input[pin >>> 3] ?? 0) >>> (pin & 7)) & 1

  for (let gate = 0; gate < gateCount; gate++) {
    const offset = gate * 7
    if (bytes[offset] !== 0) throw new TypeError('Policy evaluator supports NAND records only')
    const a = (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]
    const b = (bytes[offset + 4] << 16) | (bytes[offset + 5] << 8) | bytes[offset + 6]
    const signal = 2 + nIn + gate
    if (a >= signal || b >= signal) throw new RangeError('Invalid NAND input reference')
    signals[signal] = 1 - (signals[a] & signals[b])
  }

  const out = new Uint8Array(Math.ceil(nOut / 8))
  for (let pin = 0; pin < nOut; pin++) out[pin >>> 3] |= signals[signals.length - nOut + pin] << (pin & 7)
  return toHex(out)
}
