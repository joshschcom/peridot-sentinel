// Keyless reader of the deployed routes and fixed independent RPCs. See VERIFY.md.
import {createHash} from 'node:crypto'
import {lstat, mkdir, writeFile} from 'node:fs/promises'
import {dirname} from 'node:path'
import {pathToFileURL} from 'node:url'
import {parseArgs} from 'node:util'
import {base58} from '@scure/base'
import {getAddress} from 'viem'
import {pair} from './quote.mjs'

export const subjects = [
  {chainIndex:'196', address:getAddress(pair.WOKB), symbol:'OKB', decimals:18, rpc:'https://rpc.xlayer.tech'},
  {chainIndex:'1', address:'0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', symbol:'ETH', decimals:18, rpc:'https://ethereum-rpc.publicnode.com'},
  {chainIndex:'8453', address:'0x4200000000000000000000000000000000000006', symbol:'ETH', decimals:18, rpc:'https://mainnet.base.org'},
  {chainIndex:'501', address:'So11111111111111111111111111111111111111112', symbol:'SOL', decimals:9, rpc:'https://api.mainnet-beta.solana.com'},
]
const genesis = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d'
const quoteAmount = '1000000000000000000'
const nullReasons = {
  ok:[null,'tokens-omitted'], empty:[null,'tokens-omitted'], unsupported:['unsupported-chain'], 'not-entitled':['not-entitled'],
  'rate-limited':['rate-limited'], unavailable:['credentials-missing','provider-unavailable','malformed-provider','native-marker-unverified',
    'malformed-too-large','malformed-inventory','malformed-chain','malformed-owner','malformed-token-symbol','malformed-risk-flag',
    'malformed-duplicate-asset','malformed-scope-count','malformed-data','malformed-decimal','malformed-integer','malformed-address'],
}
const credentialPattern = /(?:OK[-_]ACCESS[-_]|OKX_API_|Bearer\s+|-----BEGIN.*PRIVATE KEY|(?:api[-_ ]?key|passphrase|secret[-_ ]?key)|[a-z]+:\/\/|\b[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}\b|\b0x[a-f\d]{64}\b|\b(?=[a-f\d]*[a-f])(?:[a-f\d]{64}|[a-f\d]{32})\b|\b[A-Za-z\d+/]{43}=|\b(?:sk[-_]|gh[pousr]_|github_pat_|xox[baprs]-|AKIA)[\w-]{12,}|\beyJ[\w-]+\.[\w-]+\.[\w-]+)/i
const unsigned = /^(?:0|[1-9]\d{0,77})$/
const decimal = /^(?:0|[1-9]\d*)(?:\.\d+)?$/
const quantity = /^0x(?:0|[1-9a-f][0-9a-f]{0,63})$/i
const hash = /^0x[0-9a-f]{64}$/i
const stamp = ms => new Date(ms).toISOString()
const check = ok => { if (!ok) throw Error('Invalid observation') }

function keys(body, names) {
  check(body && typeof body === 'object' && !Array.isArray(body))
  const allowed = names.split(' ')
  check(Object.keys(body).length === allowed.length && allowed.every(k => Object.hasOwn(body,k)))
}
function validTime(value) {
  return typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) &&
    Number.isFinite(Date.parse(value)) && stamp(Date.parse(value)) === value
}
function validDecimal(value) { return typeof value === 'string' && value.length <= 180 && decimal.test(value) }
function validUint(value) { return typeof value === 'string' && unsigned.test(value) && BigInt(value) < 2n ** 256n }
function statusAndReason(row) {
  check(Object.hasOwn(nullReasons,row.status) && nullReasons[row.status].includes(row.reason))
}
const tolerance = decimals => decimals === 9 ? 1n : 10n ** 10n
const difference = (a,b) => a >= b ? a-b : b-a
function nativeAmount(token, decimals) {
  const [whole,fraction=''] = token.balance.split('.')
  check(!/[1-9]/.test(fraction.slice(decimals)))
  const value = BigInt(whole + fraction.slice(0,decimals).padEnd(decimals,'0'))
  if (token.rawBalance === null) return value.toString()
  check(difference(value,BigInt(token.rawBalance)) <= tolerance(decimals))
  return token.rawBalance
}
function portfolio(body, watch) {
  keys(body,'schema source credentials requestedAt networks')
  check(body.schema === 'peridot.okx-portfolio/v1' && body.source === 'OKX Onchain OS' &&
    ['present','missing'].includes(body.credentials) && validTime(body.requestedAt))
  check(Array.isArray(body.networks) && body.networks.length === 1)
  const [row] = body.networks
  keys(row,'chainIndex address status reason requestedAt receivedAt tokens walletUsd walletUsdScope')
  check(row.chainIndex === watch.chainIndex && row.address === watch.address && row.walletUsdScope === 'wallet-tokens')
  check(validTime(row.requestedAt) && validTime(row.receivedAt) && row.requestedAt <= row.receivedAt)
  statusAndReason(row)
  check((body.credentials === 'missing') === (row.reason === 'credentials-missing'))
  check(row.walletUsd === null || validDecimal(row.walletUsd))
  check(Array.isArray(row.tokens) && row.tokens.length <= 10000)
  if (row.status !== 'ok') check(row.tokens.length === 0)
  let amount = null
  const seen = new Set()
  for (const t of row.tokens) {
    keys(t,'tokenAddress symbol balance rawBalance priceUsd isNative')
    check(typeof t.symbol === 'string' && t.symbol.length > 0 && t.symbol.length <= 128)
    check(validDecimal(t.balance) && (t.rawBalance === null || validUint(t.rawBalance)) &&
      (t.priceUsd === null || validDecimal(t.priceUsd)) && typeof t.isNative === 'boolean')
    if (t.isNative) {
      check(t.tokenAddress === null && t.symbol === watch.symbol)
      amount = nativeAmount(t,watch.decimals)
    } else if (watch.chainIndex === '501') {
      check(typeof t.tokenAddress === 'string' && t.tokenAddress.length <= 44 && base58.decode(t.tokenAddress).length === 32)
    } else {
      check(typeof t.tokenAddress === 'string' && /^0x[0-9a-f]{40}$/i.test(t.tokenAddress))
    }
    const asset = watch.chainIndex === '501' ? t.tokenAddress : t.tokenAddress?.toLowerCase()
    check(!seen.has(asset))
    seen.add(asset)
  }
  return {status:row.status, reason:row.reason, credentials:body.credentials, providerRequestedAt:row.requestedAt,
    providerReceivedAt:row.receivedAt, nativeRaw:amount}
}
function quote(body) {
  keys(body,'schema status reason chainId tokenIn amountIn tokenOut amountOut observedAt')
  statusAndReason(body)
  check(body.schema === 'peridot.okx-quote/v1' && body.chainId === 196 && body.tokenIn?.toLowerCase() === pair.WOKB &&
    body.tokenOut?.toLowerCase() === pair.USDC && body.amountIn === quoteAmount && validTime(body.observedAt))
  check(body.status === 'ok' ? validUint(body.amountOut) && BigInt(body.amountOut) > 0n : body.amountOut === null)
  return {status:body.status, reason:body.reason, chainId:196, tokenIn:pair.WOKB, amountIn:quoteAmount,
    tokenOut:pair.USDC, amountOut:body.amountOut, observedAt:body.observedAt}
}

async function readText(response) {
  const chunks = []
  let size = 0
  for await (const chunk of response.body) {
    size += chunk.length
    check(size <= 4 * 1024 * 1024)
    chunks.push(chunk)
  }
  return Buffer.concat(chunks).toString('utf8')
}

// Keep route/RPC error bodies out of the evidence and all thrown messages.
async function route(origin, path, inspect, expectedHttp, request, now) {
  const start = now()
  let httpStatus = null, bodyCheck = 'unavailable', result = null
  try {
    const response = await request(new URL(path,origin),{redirect:'error',signal:AbortSignal.timeout(45000)})
    httpStatus = response.status
    const text = await readText(response)
    bodyCheck = 'invalid'
    if (credentialPattern.test(text)) bodyCheck = 'sensitive-pattern'
    else {
      const json = JSON.parse(text)
      if (credentialPattern.test(JSON.stringify(json))) bodyCheck = 'sensitive-pattern'
      else if (httpStatus === expectedHttp) {
        result = inspect(json)
        bodyCheck = 'verified'
      }
    }
  } catch { /* Untrusted input must not escape. */ }
  const end = now()
  return {httpStatus, bodyCheck, requestedAt:stamp(start), receivedAt:stamp(end), latencyMs:end-start, result}
}

async function rpc(watch, method, params, request) {
  const response = await request(watch.rpc,{method:'POST',redirect:'error',signal:AbortSignal.timeout(10000),
    headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})})
  check(response.ok)
  // Solana returns JSON numeric u64 lamports. Use the original token, even above 2^53.
  const json = JSON.parse(await readText(response),(_,value,ctx) =>
    typeof value === 'number' ? BigInt(ctx.source) : value)
  check(json.jsonrpc === '2.0' && json.id === 1n && !json.error && json.result !== undefined)
  return json.result
}
async function independent(watch, request, now) {
  const start = now()
  const read = (method,params) => rpc(watch,method,params,request)
  let observation = null
  try {
    if (watch.chainIndex === '501') {
      check(await read('getGenesisHash',[]) === genesis)
      const {context,value} = await read('getBalance',[watch.address,{commitment:'finalized'}])
      check(typeof value === 'bigint' && value >= 0n && value < 2n**64n && typeof context.slot === 'bigint' && context.slot > 0n)
      observation = {slot:context.slot.toString(),commitment:'finalized',nativeRaw:value.toString()}
    } else {
      const chain = await read('eth_chainId',[])
      check(typeof chain === 'string' && quantity.test(chain) && BigInt(chain) === BigInt(watch.chainIndex))
      const block = await read('eth_getBlockByNumber',['latest',false])
      check(typeof block.number === 'string' && quantity.test(block.number) && BigInt(block.number)>0n && hash.test(block.hash))
      const balance = await read('eth_getBalance',[watch.address,block.number])
      check(typeof balance === 'string' && quantity.test(balance))
      const verified = await read('eth_getBlockByNumber',[block.number,false])
      check(verified.number === block.number && verified.hash === block.hash)
      observation = {block:BigInt(block.number).toString(),blockHash:block.hash,nativeRaw:BigInt(balance).toString()}
    }
  } catch { /* A missing witness leaves this network unverified. */ }
  const end = now()
  return {provider:new URL(watch.rpc).hostname,requestedAt:stamp(start),receivedAt:stamp(end),latencyMs:end-start,observation}
}

function current(observedAt, receivedAt, maxAgeMs) {
  const age = Date.parse(receivedAt)-Date.parse(observedAt)
  return age >= -10000 && age <= maxAgeMs
}
function comparison(app, witness, decimals) {
  const data = app.result, rpcData = witness.observation
  if (data?.status !== 'ok' || data.nativeRaw === null || !rpcData) return {status:'unverified',differenceRaw:null}
  if (!current(data.providerReceivedAt,app.receivedAt,300000)) return {status:'stale',differenceRaw:null}
  const a = BigInt(data.nativeRaw), b = BigInt(rpcData.nativeRaw)
  const delta = difference(a,b)
  return {status:a > 0n && b > 0n && delta <= tolerance(decimals) ? 'agree' : 'disagree',differenceRaw:delta.toString()}
}

export async function verifyLive(baseUrl,{fetch:request=globalThis.fetch,now=Date.now}={}) {
  let base
  try { base = new URL(baseUrl) } catch { throw Error('Expected an HTTPS app origin') }
  check(base.protocol === 'https:' && !base.username && !base.password && base.pathname === '/' && !base.search && !base.hash)
  const start = now()
  const networks = []
  for (const watch of subjects) {
    const params = new URLSearchParams({subjects:watch.chainIndex+':'+watch.address})
    const [app,witness] = await Promise.all([
      route(base.origin,'/api/onchainos/portfolio?'+params,b=>portfolio(b,watch),200,request,now),
      independent(watch,request,now),
    ])
    networks.push({chainIndex:watch.chainIndex,address:watch.address,symbol:watch.symbol,decimals:watch.decimals,
      toleranceRaw:tolerance(watch.decimals).toString(),app,independent:witness,comparison:comparison(app,witness,watch.decimals)})
  }
  const quoted = await route(base.origin,'/api/onchainos/quote?from=WOKB&amount='+quoteAmount,quote,200,request,now)
  const invalidInput = await route(base.origin,'/api/onchainos/portfolio?subjects=0:invalid',b=>{
    keys(b,'error')
    check(b.error === 'Invalid request')
    return {providerCalls:'not-observable-over-http'}
  },400,request,now)
  const sanitizedBodies = [...networks.map(row=>row.app),quoted,invalidInput].every(item=>item.bodyCheck === 'verified')
  const quoteVerified = quoted.result?.status === 'ok' && current(quoted.result.observedAt,quoted.receivedAt,60000)
  const checksPassed = sanitizedBodies && quoteVerified && networks.every(row=>row.comparison.status === 'agree' ||
    ['unsupported','not-entitled'].includes(row.app.result?.status))
  return {schema:'peridot.okx-verification/v1',deploymentOriginSha256:createHash('sha256').update(base.origin).digest('hex'),
    startedAt:stamp(start),finishedAt:stamp(now()),networks,quote:{...quoted,verified:quoteVerified},invalidInput,
    sanitizedBodies,checksPassed,verifiedChainIndices:networks.filter(row=>row.comparison.status==='agree').map(row=>row.chainIndex)}
}

if (process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  try {
    const {values} = parseArgs({options:{'base-url':{type:'string'},out:{type:'string'}}})
    check(values.out)
    await lstat(values.out).then(()=>{ throw Error('Choose a new report file') },error=>{ if (error.code !== 'ENOENT') throw error })
    const report = await verifyLive(values['base-url'])
    await mkdir(dirname(values.out),{recursive:true})
    await writeFile(values.out,JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600})
    if (!report.checksPassed) process.exitCode = 1
  } catch {
    console.error('Verification could not run or create the requested report. Use an HTTPS origin and a new output file.')
    process.exitCode = 1
  }
}
