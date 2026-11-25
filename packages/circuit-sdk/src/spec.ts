import { keccak_256 } from '@noble/hashes/sha3'
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils'

export type Hex = `0x${string}`

export const Op = {
  SUPPLY: 0,
  REDEEM: 1,
  BORROW: 2,
  REPAY: 3,
  ENTER_COLLATERAL: 4,
  EXIT_COLLATERAL: 5,
  MARGIN_OPEN: 6,
  MARGIN_CLOSE: 7,
  REBALANCE: 8,
  TRANSFER: 9,
} as const
export type Op = typeof Op[keyof typeof Op]

export type PolicyKind = 'MARKET' | 'ACCOUNT'
export interface MarketMaxLtvParams {
  maxLtvBps: number
  requireCashReserve: boolean
}
export interface AccountGuardParams {
  maxLtvBps: number
  allowedOps: readonly Op[]
}

export type PolicySpec = {
  schema: 'peridot.policy/v1'
  templateVersion: 0
  label?: string
} & (
  | { kind: 'MARKET'; templateId: 'market-max-ltv-v0'; params: MarketMaxLtvParams }
  | { kind: 'ACCOUNT'; templateId: 'account-guard-v0'; params: AccountGuardParams }
)

function objectWithKeys(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Expected a policy object')
  }
  for (const key of Object.keys(value)) {
    if (!keys.includes(key)) throw new TypeError(`Unknown policy field: ${key}`)
  }
  return value as Record<string, unknown>
}

export function parseBps(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 10_000) {
    throw new RangeError('Basis points must be an integer in [0, 10000]')
  }
  return value
}

export function parseOp(value: unknown): Op {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > Op.TRANSFER) {
    throw new RangeError('Unknown operation')
  }
  return value as Op
}

/** Returns a validated copy with numeric operations sorted; duplicate permissions are ambiguous. */
export function validatePolicySpec(value: unknown): PolicySpec {
  const spec = objectWithKeys(value, ['schema', 'kind', 'templateId', 'templateVersion', 'params', 'label'])
  if (spec.schema !== 'peridot.policy/v1' || spec.templateVersion !== 0) {
    throw new TypeError('Unsupported schema or template version')
  }
  if (spec.label !== undefined && typeof spec.label !== 'string') throw new TypeError('Invalid policy label')
  const common = {
    schema: spec.schema,
    templateVersion: spec.templateVersion,
    ...(spec.label === undefined ? {} : {label: spec.label}),
  } as const
  if (spec.kind === 'MARKET' && spec.templateId === 'market-max-ltv-v0') {
    const params = objectWithKeys(spec.params, ['maxLtvBps', 'requireCashReserve'])
    const maxLtvBps = parseBps(params.maxLtvBps)
    if (typeof params.requireCashReserve !== 'boolean') throw new TypeError('Expected requireCashReserve boolean')
    return {...common, kind: spec.kind, templateId: spec.templateId, params: {maxLtvBps, requireCashReserve: params.requireCashReserve}}
  }
  if (spec.kind === 'ACCOUNT' && spec.templateId === 'account-guard-v0') {
    const params = objectWithKeys(spec.params, ['maxLtvBps', 'allowedOps'])
    const maxLtvBps = parseBps(params.maxLtvBps)
    if (!Array.isArray(params.allowedOps) || params.allowedOps.length > 10) {
      throw new TypeError('Expected a list of up to 10 distinct operations')
    }
    const allowedOps = Array.from(params.allowedOps, parseOp).sort((a, b) => a - b)
    if (new Set(allowedOps).size !== allowedOps.length) throw new TypeError('Duplicate operation')
    return {...common, kind: spec.kind, templateId: spec.templateId, params: {maxLtvBps, allowedOps}}
  }
  throw new TypeError('Unsupported policy kind and template combination')
}

export function canonicalPolicyJson(value: PolicySpec): string {
  const spec = validatePolicySpec(value)
  // Keys at each level are explicitly in lexical order, including nested params.
  const params = spec.kind === 'MARKET'
    ? {maxLtvBps: spec.params.maxLtvBps, requireCashReserve: spec.params.requireCashReserve}
    : {allowedOps: spec.params.allowedOps, maxLtvBps: spec.params.maxLtvBps}
  return JSON.stringify({kind: spec.kind, params, schema: spec.schema, templateId: spec.templateId, templateVersion: spec.templateVersion})
}

export function hashPolicySpec(spec: PolicySpec): Hex {
  return `0x${bytesToHex(keccak_256(utf8ToBytes(canonicalPolicyJson(spec))))}`
}

export function fromHex(value: Hex): Uint8Array {
  if (typeof value !== 'string' || !value.startsWith('0x')) throw new TypeError('Expected 0x-prefixed hex bytes')
  return hexToBytes(value.slice(2))
}

export function toHex(value: Uint8Array): Hex {
  return `0x${bytesToHex(value)}`
}

export function hashNetlist(netlist: Hex): Hex {
  return toHex(keccak_256(fromHex(netlist)))
}
