// Node-only transport. Route handlers share one instance across portfolio and quote reads.
import {createHmac} from 'node:crypto'
import {setTimeout as delay} from 'node:timers/promises'
import {canonical} from './portfolio-prep/reads.mjs'

const origin = 'https://web3.okx.com'
const maxBytes = 2 * 1024 * 1024
const sharedKey = Symbol.for('peridot.onchainos.provider-budget.v1')
const schedules = globalThis[sharedKey] ??= new WeakMap()
const malformed = () => ({status:'unavailable', reason:'malformed-provider'})
const unavailable = () => ({status:'unavailable', reason:'provider-unavailable'})
const rateLimited = () => ({status:'rate-limited', reason:'rate-limited'})
const notEntitled = () => ({status:'not-entitled', reason:'not-entitled'})

// OKX Balance (81104), Trade (82105), and common Onchain OS authentication/entitlement codes.
const deniedCodes = new Set(['50030','50102','50103','50104','50105','50106','50107',
  '50110','50111','50112','50113','50114','50119','50120','50125'])
const unsupportedCodes = new Set(['50038','81104','82105'])

export function hasCredentials(env) {
  return [env?.OKX_API_KEY, env?.OKX_API_SECRET, env?.OKX_API_PASSPHRASE]
    .every(v => typeof v === 'string' && v.trim().length > 0)
}

async function boundedJson(response) {
  const reader = response.body.getReader()
  const chunks = []
  let size = 0
  try {
    for (;;) {
      const {value, done} = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > maxBytes) {
        await reader.cancel()
        throw Error('Payload too large')
      }
      chunks.push(value)
    }
    return JSON.parse(new TextDecoder('utf-8', {fatal:true}).decode(Buffer.concat(chunks, size)))
  } finally {
    reader.releaseLock()
  }
}

function retryDelay(header, clock) {
  if (!header) return 200
  const ms = /^\d+$/.test(header) ? Number(header) * 1000 : Date.parse(header) - clock
  return Number.isFinite(ms) ? Math.max(200, ms) : 200
}

// Next can load a module in several route bundles in the same worker. Keep a
// single budget for its transport/clock even if a route supplies a new env object.
function budgetFor(request, now) {
  let clocks = schedules.get(request)
  if (!clocks) {
    clocks = new WeakMap()
    schedules.set(request, clocks)
  }
  let budget = clocks.get(now)
  if (!budget) {
    budget = {starts:[], waiters:[], active:0}
    clocks.set(now, budget)
  }
  return budget
}

// The limiter counts individual HTTP attempts at dispatch, including retries. Bounded
// waiting prevents a burst of callers from building an unbounded backlog.
export function createProvider({env, fetch:request, now}) {
  const budget = budgetFor(request, now)
  const {waiters, starts} = budget

  async function attempt(path, subjectBudget) {
    if (budget.active < 2) budget.active++
    else {
      if (waiters.length >= 28) return {result:rateLimited()}
      await new Promise(resolve => waiters.push(resolve))
    }
    try {
      const clock = new Date(now()).valueOf()
      while (starts.length && starts[0] <= clock - 60000) starts.shift()
      if (starts.length >= 30 || subjectBudget?.remaining === 0) return {result:rateLimited()}
      const timestamp = new Date(clock).toISOString()
      const headers = {
        'OK-ACCESS-KEY':env.OKX_API_KEY,
        'OK-ACCESS-PASSPHRASE':env.OKX_API_PASSPHRASE,
        'OK-ACCESS-TIMESTAMP':timestamp,
        'OK-ACCESS-SIGN':createHmac('sha256', env.OKX_API_SECRET).update(timestamp + 'GET' + path).digest('base64'),
      }
      starts.push(clock)
      if (subjectBudget) subjectBudget.remaining--
      const res = await request(origin + path, {method:'GET', redirect:'error', cache:'no-store',
        signal:AbortSignal.timeout(6000), headers})
      if (res.status === 401 || res.status === 403 || res.status === 429 || res.status >= 500) {
        await res.body?.cancel()
        if (res.status === 401 || res.status === 403) return {result:notEntitled()}
        return {result:res.status === 429 ? rateLimited() : unavailable(),
          retryMs:retryDelay(res.headers.get('retry-after'), clock)}
      }
      let body
      try { body = await boundedJson(res) } catch { return {result:res.ok ? malformed() : unavailable()} }
      if (deniedCodes.has(body?.code)) return {result:notEntitled()}
      if (unsupportedCodes.has(body?.code)) return {result:{status:'unsupported', reason:'unsupported-chain'}}
      if (body?.code === '50011') return {result:rateLimited()}
      if (!res.ok) return {result:unavailable()}
      if (typeof body?.code !== 'string' || !/^\d{1,16}$/.test(body.code)) return {result:malformed()}
      if (body.code !== '0') return {result:unavailable()}
      if (!Array.isArray(body.data)) return {result:malformed()}
      return {result:{status:'ok', body:{code:'0', data:body.data}}}
    } catch {
      return {result:unavailable()}
    } finally {
      const next = waiters.shift()
      if (next) next()
      else budget.active--
    }
  }

  async function read(plan, subjectBudget) {
    if (!hasCredentials(env)) return {status:'unavailable', reason:'credentials-missing'}
    try {
      // Derive the entire target from the same allowlist as the request planner.
      const {kind, method, path} = canonical(plan)
      if (plan.origin !== origin || plan.method !== method || plan.path !== path) return malformed()
      const first = await attempt(path, subjectBudget)
      // Capability discovery has a strict daily call budget. A long Retry-After
      // is respected by returning the failure instead of retrying early.
      if (kind === 'chains' || subjectBudget?.remaining === 0 || first.retryMs === undefined || first.retryMs > 1500) return first.result
      await delay(first.retryMs)
      return (await attempt(path, subjectBudget)).result
    } catch {
      return unavailable()
    }
  }
  return {read}
}
