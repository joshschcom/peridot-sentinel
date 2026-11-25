import { parseBps, parseOp, toHex, type Hex, type Op } from './spec.js'

export const CONTEXT_INPUTS = 20

export interface PolicyContext {
  op: Op
  oracleFresh: boolean
  postLtvBps: number | bigint
  cashOk: boolean
}

/** Packs the 20 interface-v1 inputs in TAP-02 pin order, with zero high padding. */
export function encodeContext(context: PolicyContext): Hex {
  const {oracleFresh, cashOk} = context
  if (typeof oracleFresh !== 'boolean' || typeof cashOk !== 'boolean') {
    throw new TypeError('Expected boolean oracleFresh and cashOk')
  }
  const op = parseOp(context.op)
  // Every accepted value fits exactly in 14 bits; parseBps rejects values outside the domain.
  const postLtvBps = parseBps(typeof context.postLtvBps === 'bigint' ? Number(context.postLtvBps) : context.postLtvBps)
  const word = op | (Number(oracleFresh) << 4) | (postLtvBps << 5) | (Number(cashOk) << 19)
  return toHex(Uint8Array.of(word & 255, (word >> 8) & 255, (word >> 16) & 15))
}
