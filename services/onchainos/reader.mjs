// Node route handlers only. env is supplied by the host. All provider access is by an allowlisted GET.
import {normalize, pair, portfolioPlan, quotePlan} from './portfolio-prep/reads.mjs'
import {createProvider, hasCredentials} from './provider.mjs'
import {parseQuoteResult} from './quote.mjs'

const source = 'OKX Onchain OS'
const nativeSymbols = Object.freeze({'1':'ETH', '196':'OKB', '8453':'ETH', '501':'SOL'})
const instances = globalThis[Symbol.for('peridot.onchainos.reader.v1')] ??= new WeakMap()
const unavailable = reason => ({status:'unavailable', reason})
const limited = () => ({status:'rate-limited', reason:'rate-limited'})
const invalid = () => ({status:400, body:{error:'Invalid request'}})
const stamp = now => new Date(now()).toISOString()

function useReader({env = {}, fetch:request = globalThis.fetch, now = Date.now} = {}) {
  let clocks = instances.get(request)
  if (!clocks) instances.set(request, clocks = new WeakMap())
  let reader = clocks.get(now)
  const keys = [env.OKX_API_KEY, env.OKX_API_SECRET, env.OKX_API_PASSPHRASE]
  if (!reader || keys.some((value,i) => value !== reader.keys[i])) {
    // Invalidate wallet/quote caches on credential rotation. Do not reset discovery's daily budget.
    const previous = reader?.capability
    reader = {now, keys, provider:createProvider({env,fetch:request,now}), cache:new Map(),
      capability:previous && {until:previous.until, result:Promise.resolve(unavailable('provider-unavailable'))}}
    clocks.set(now, reader)
  }
  return reader
}

function matchesCredential(value, keys) {
  return typeof value === 'string' && keys.some(key => typeof key === 'string' && key.length && value.includes(key))
}

function parameters(params, names) {
  if (!params || params.size !== names.length) throw Error()
  return names.map(name => {
    const values = params.getAll(name)
    if (values.length !== 1) throw Error()
    return values[0]
  })
}

function walletPlans(params) {
  const [list] = parameters(params,['subjects'])
  if (!list || list.length > 200) throw Error()
  const parts = list.split(',')
  if (parts.length > 4) throw Error()
  const subjects = parts.map(part => {
    const match = /^(196|1|8453|501):([^:,]+)$/.exec(part)
    if (!match) throw Error()
    const [,chainIndex,raw] = match
    if (chainIndex !== '501' && !/^0x[0-9a-fA-F]{40}$/.test(raw)) throw Error()
    return {chainIndex,address:chainIndex === '501' ? raw : raw.toLowerCase(),role:'watch'}
  })
  return portfolioPlan(subjects)
}

// Cache in-flight work as well as results. Return distinct response objects to callers.
async function cached(reader, key, ttl, load, onFull) {
  const {cache, now} = reader
  const time = Number(now())
  for (const [id,entry] of cache) if (entry.until <= time) cache.delete(id)
  let entry = cache.get(key)
  if (!entry) {
    if (cache.size >= 32) {
      const completed = Array.from(cache).find(([,e]) => e.until !== Infinity)
      if (!completed) return onFull()
      cache.delete(completed[0])
    }
    entry = {until:Infinity}
    entry.result = Promise.resolve().then(load).then(result => {
      entry.until = Number(now()) + ttl
      return result
    }).catch(err => { cache.delete(key); throw err })
    cache.set(key,entry)
  }
  return structuredClone(await entry.result)
}

// Our own fixed validation messages (portfolio-prep/reads.mjs) as fixed reason codes, so a rejected answer says which
// check refused it. Only these constants can appear; any other error stays 'malformed-provider'. No provider text.
const checkReasons = Object.freeze({
  'Invalid token inventory':'malformed-inventory', 'Unexpected response chain':'malformed-chain',
  'Unexpected response owner':'malformed-owner', 'Invalid token symbol':'malformed-token-symbol',
  'Missing provider risk flag':'malformed-risk-flag', 'Duplicate asset identity in response':'malformed-duplicate-asset',
  'Expected one scoped response object':'malformed-scope-count', 'Missing response data':'malformed-data',
  'Expected unsigned decimal string':'malformed-decimal', 'Expected unsigned integer string':'malformed-integer',
  'Amount exceeds uint256':'malformed-integer', 'Invalid EVM address':'malformed-address',
  'Invalid Solana address':'malformed-address', 'Expected 32-byte Solana address':'malformed-address',
})
const checkReason = error => (typeof error?.message === 'string' && Object.hasOwn(checkReasons, error.message)) ? checkReasons[error.message] : 'malformed-provider'

async function readData(reader, plan, requestedAt, subjectBudget) {
  try {
    const response = await reader.provider.read(plan,subjectBudget)
    if (response.status !== 'ok') return response
    const parsed = normalize(plan,{body:response.body,httpStatus:200,provenance:'provider-response',
      requestedAt,receivedAt:stamp(reader.now)})
    if (parsed.status !== 'received') return unavailable('malformed-provider')
    return {status:'ok',data:parsed.data}
  } catch (error) {
    return unavailable(checkReason(error))
  }
}

function supportedChains(reader, plan, requestedAt) {
  const time = Number(reader.now())
  if (!reader.capability || reader.capability.until <= time) {
    const capability = {until:time + 86_400_000, result:readData(reader,plan,requestedAt)}
    // Keep a successful discovery for a day, but a failed one only for a minute, so one transient
    // provider error at cold start does not make every network unavailable for the rest of the day.
    capability.result.then(r => { if (r.status !== 'ok') capability.until = Number(reader.now()) + 60_000 })
    reader.capability = capability
  }
  return reader.capability.result
}

function tokenRows(assets, chain, keys) {
  const tokens = []
  for (const a of assets) {
    // The Balance API's native marker is the empty contract, distinct from DEX pseudo-addresses.
    // Require the chain's expected ticker too; Claude cross-checks each network before enabling it.
    const native = a.assetAddress === null && a.symbol.toUpperCase() === nativeSymbols[chain]
    if (a.assetKind !== 'token' && !native) return unavailable('native-marker-unverified')
    const values = [a.assetAddress,a.balance,a.rawBalance,a.tokenPriceUsd]
    if (values.some(value => matchesCredential(value, keys))) return unavailable('malformed-provider')
    // An airdropped token can choose its own ticker. Keep the verified address and balance
    // while replacing hostile display text; one such token need not hide the entire wallet.
    const safeSymbol = /^[A-Za-z0-9$][A-Za-z0-9$+*_-]{0,23}(?:\.[A-Za-z0-9])?$/.test(a.symbol) &&
      !/(?:OK[-_]ACCESS|OKX[-_]API|Authorization|Bearer|sk-|gh[pousr]_)/i.test(a.symbol) &&
      !matchesCredential(a.symbol, keys)
    const symbol = safeSymbol ? (native ? nativeSymbols[chain] : a.symbol) : 'UNKNOWN'
    tokens.push({tokenAddress:a.assetAddress,symbol,
      balance:a.balance, rawBalance:a.rawBalance, priceUsd:a.tokenPriceUsd, isNative:native})
  }
  return {status:'ok', tokens}
}

function network(scope, requestedAt, receivedAt, result) {
  return {chainIndex:scope.chainIndex, address:scope.address, requestedAt, receivedAt,
    status:result.status, reason:result.reason ?? null, tokens:result.tokens ?? [],
    walletUsd:result.walletUsd ?? null, walletUsdScope:'wallet-tokens'}
}

async function readNetwork(reader, inventory, subtotal, supported, at) {
  const {scope} = inventory
  const done = result => network(scope,at,stamp(reader.now),result)
  if (supported.status !== 'ok') return done(supported)
  if (!supported.data.supported.includes(scope.chainIndex)) return done({status:'unsupported',reason:'unsupported-chain'})
  const subjectBudget = {remaining:2}
  const inventoryResult = await readData(reader,inventory,at,subjectBudget)
  if (inventoryResult.status !== 'ok') return done(inventoryResult)
  const tokens = tokenRows(inventoryResult.data.assets,scope.chainIndex,reader.keys)
  if (tokens.status !== 'ok') return done(tokens)
  const total = await readData(reader,subtotal,at,subjectBudget)
  if (total.status !== 'ok') return done(total)
  const walletUsd = total.data.walletTokensUsd
  if (matchesCredential(walletUsd,reader.keys)) return done(unavailable('malformed-provider'))
  return done({status:tokens.tokens.length ? 'ok' : 'empty',tokens:tokens.tokens,walletUsd})
}

export async function handlePortfolio(searchParams, opts = {}) {
  let plans
  try { plans = walletPlans(searchParams) } catch { return invalid() }
  const reader = useReader(opts)
  const at = stamp(reader.now)
  const inventories = plans.filter(p => p.kind === 'inventory')
  const credentials = hasCredentials(opts.env) ? 'present' : 'missing'
  const body = networks => ({schema:'peridot.okx-portfolio/v1',source,credentials,requestedAt:at,networks})
  const all = result => body(inventories.map(p=>network(p.scope,at,at,result)))
  if (inventories.some(p => matchesCredential(p.scope.address,reader.keys))) return invalid()
  if (credentials === 'missing') return {status:200,body:all(unavailable('credentials-missing'))}
  const key = inventories.map(({scope:s}) => s.chainIndex+':'+(s.chainIndex==='501'?s.address:s.address.toLowerCase())).join(',')
  const result = await cached(reader,'portfolio/'+key,60_000,async () => {
    const supported = await supportedChains(reader,plans[0],at)
    const networks = await Promise.all(inventories.map((p,i) => readNetwork(reader,p,plans[2*i+2],supported,at)))
    return body(networks)
  },()=>all(limited()))
  return {status:200,body:result}
}

export async function handleQuote(searchParams, opts = {}) {
  let plan
  try { plan = quotePlan(...parameters(searchParams,['from','amount'])) } catch { return invalid() }
  const reader = useReader(opts)
  const observedAt = stamp(reader.now)
  const {from,amountIn} = plan.scope
  const body = (result,amountOut = null) => ({schema:'peridot.okx-quote/v1',status:result.status,reason:result.reason ?? null,
    chainId:196,tokenIn:pair[from],amountIn,tokenOut:pair[from === 'WOKB' ? 'USDC' : 'WOKB'],amountOut,observedAt})
  if (matchesCredential(amountIn,reader.keys)) return invalid()
  if (!hasCredentials(opts.env)) return {status:200,body:body(unavailable('credentials-missing'))}
  const result = await cached(reader,'quote/'+from+'/'+amountIn,15_000,async () => {
    const response = await reader.provider.read(plan)
    if (response.status !== 'ok') return body(response)
    try {
      const q = parseQuoteResult(plan,response.body,observedAt)
      if (matchesCredential(q.amountOut,reader.keys)) return body(unavailable('malformed-provider'))
      return body({status:'ok'},q.amountOut)
    } catch { return body(unavailable('malformed-provider')) }
  },()=>body(limited()))
  return {status:200,body:result}
}
