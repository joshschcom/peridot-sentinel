import {wordlist} from '@scure/bip39/wordlists/english'
import {keccak256, stringToHex} from 'viem'
import schema from './strategy.schema.json' with { type: 'json' }
import debtExample from './templates/debt-protection-v1.json' with { type: 'json' }
import swapExample from './templates/restricted-swap-v2.json' with { type: 'json' }

type Asset = (typeof debtExample.allowedAssets)[number]
type FixedKeys = 'profile' | 'allowedAssets' | 'allowedOperations' | 'chainId' | 'schema'
type Header = {schema:'peridot.strategy/v1';chainId:1952}
type Debt = Omit<typeof debtExample, FixedKeys> & Header & {
  profile:'debt-protection-v1'; allowedOperations:['AUTO_REPAY']; allowedAssets:[Asset]
}
type Swap = Omit<typeof swapExample, FixedKeys> & Header & {
  profile:'restricted-swap-v2'; allowedOperations:['SWAP_EXACT_IN']; allowedAssets:[Asset,Asset]
}
export type Strategy = Debt | Swap
type RecordValue = Record<string, unknown>

const seedWords = new Set(wordlist)
const publicProse = ['name','description','objective','agentInstructions'] as const
const reject = () => {throw new Error('Unsupported strategy data or unsafe budget')}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']'
  if (value !== null && typeof value === 'object') {
    const record = value as RecordValue
    return '{' + Object.keys(record).sort().map(key => JSON.stringify(key)+':'+canonical(record[key])).join(',') + '}'
  }
  return JSON.stringify(value)
}

function plainText(value: string): boolean {
  if (value.trim() !== value || value.length === 0) return false
  // Text has no use for credential-shaped blobs, account addresses, URLs or authority assignments.
  if (/0x[0-9a-f]{8,}|[a-z0-9]{24,}|[a-f0-9]{20,}|(?:https?:\/\/|www\.|private[ -]?key|api[ -]?key|pass(?:word|phrase)|mnemonic|secret|seed phrase|bearer|grant[ -]?id|AKIA|gh[pousr]-|sk-)/i.test(value)) return false
  let run = 0
  for (const word of value.toLowerCase().split(/[^a-z]+/)) {
    run = seedWords.has(word) ? run + 1 : 0
    if (run >= 12) return false
  }
  return true
}

// This handles the exact keywords emitted by catalog.mjs; unknown rules fail closed.
type Rule = {const?:unknown;type?:string;properties?:Record<string,Rule|undefined>;required?:string[];additionalProperties?:boolean;
  minLength?:number;maxLength?:number;pattern?:string;minimum?:number;maximum?:number}
function matches(value:unknown, rule:Rule): boolean {
  if (Object.hasOwn(rule,'const')) return canonical(value) === canonical(rule.const)
  if (rule.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false
    const record = value as RecordValue
    const fields = rule.properties!
    return Object.keys(record).length === rule.required!.length &&
      rule.required!.every(key=>Object.hasOwn(record,key) && fields[key]!==undefined && matches(record[key],fields[key]))
  }
  if (rule.type === 'integer') return typeof value === 'number' && Number.isSafeInteger(value) &&
    value >= rule.minimum! && value <= rule.maximum!
  if (rule.type === 'string') return typeof value === 'string' && value.length >= (rule.minLength ?? 1) &&
    value.length <= (rule.maxLength ?? 500) && new RegExp(rule.pattern!).exec(value)?.[0] === value
  return false
}

function countKeys(value:unknown): number {
  if (!value || typeof value !== 'object') return 0
  return Object.entries(value).reduce((sum,[,child])=>sum+countKeys(child),Array.isArray(value)?0:Object.keys(value).length)
}

/** Accept wire JSON only. Values, templates and content hashes have no signing authority. */
export function importStrategy(json:string) {
  if (typeof json !== 'string' || json.length > 8192) reject()
  let parsed:unknown
  try { parsed = JSON.parse(json) } catch { return reject() }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return reject()
  const profile = (parsed as RecordValue).profile
  const index = profile === 'debt-protection-v1' ? 0 : profile === 'restricted-swap-v2' ? 1 : -1
  const rule = schema.oneOf[index]
  if (!rule || !matches(parsed,rule)) return reject()
  // The parser has validated syntax. Count whole string tokens followed by a colon to catch
  // duplicate keys, including escaped spellings, which JSON.parse otherwise discards.
  const keys = [...json.matchAll(/"(?:\\.|[^"\\])*"(\s*:)?/g)].filter(match=>match[1]).length
  if (keys !== countKeys(parsed)) return reject()
  const template = parsed as Strategy
  if (!publicProse.every(key=>plainText(template[key]))) return reject()
  const cumulative = BigInt(template.budget.cumulativeRaw)
  if (template.profile === 'debt-protection-v1') {
    if (cumulative > 2_000_000n) return reject()
  } else {
    const perCall = BigInt(template.budget.perCallRaw)
    if (perCall > 10n**18n || cumulative > 2n*10n**18n || perCall > cumulative) return reject()
  }
  const encoded = canonical(template)
  return { template, canonical:encoded, hash:keccak256(stringToHex(encoded)) }
}

export function curatedStrategies() {
  return [debtExample,swapExample].map(value=>importStrategy(JSON.stringify(value)))
}
