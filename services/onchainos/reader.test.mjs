// Entirely synthetic: the only transport these tests inject is the function below.
import assert from 'node:assert/strict'
import test from 'node:test'
import {setImmediate as nextTurn} from 'node:timers/promises'
import {base58} from '@scure/base'
import {getAddress} from 'viem'
import {handlePortfolio, handleQuote} from './reader.mjs'
import {pair} from './quote.mjs'

const evm = '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd'
const asset = '0x1234567890abcdef1234567890abcdef12345678'
const sol = base58.encode(Uint8Array.from({length:32}, (_,i)=>9+i))
const mint = base58.encode(Uint8Array.from({length:32}, (_,i)=>71-i))
const chains = ['196','1','8453','501']
const subjects = chains.map(id=>id+':'+(id==='501'?sol:evm))
const fakeCredentials = {OKX_API_KEY:'FixtureApiKeyA6', OKX_API_SECRET:'FixtureApiSecretA6', OKX_API_PASSPHRASE:'FixturePassphraseA6'}
const paths = new Map([
  ['/api/v6/dex/balance/supported/chain','chains'], ['/api/v6/dex/balance/all-token-balances-by-address','inventory'],
  ['/api/v6/dex/balance/total-value-by-address','usd'], ['/api/v6/dex/aggregator/quote','quote'],
])
const balance = '9007199254740993.120003400000000001'
const rawBalance = '9007199254740993120003400000000001'
const walletUsd = '10000000000000000000.000000000000000001'
const stamp = Date.parse('2026-11-28T00:00:00Z')
const ok = data=>Response.json({code:'0',data})
const fail = (http,code='50000',msg='ignored response detail')=>Response.json({code,msg,data:[]},{status:http})

function token(call,changes={}) {
  return {chainIndex:call.chain, address:call.address, tokenContractAddress:call.chain==='501'?mint:asset,
    symbol:'SYN', balance, rawBalance, tokenPrice:'', isRiskToken:false, ...changes}
}
function valid(call) {
  switch (call.kind) {
    case 'chains': return ok(chains.map(chainIndex=>({chainIndex})))
    case 'inventory': return ok([{tokenAssets:[token(call)]}])
    case 'usd': return ok([{totalValue:walletUsd}])
    case 'quote': return ok([{chainIndex:'196',fromToken:{tokenContractAddress:call.q.get('fromTokenAddress')},
      toToken:{tokenContractAddress:call.q.get('toTokenAddress')},fromTokenAmount:call.q.get('amount'),toTokenAmount:'12345678901234567890'}])
    default: throw Error('Unexpected synthetic route')
  }
}
function fixture(reply=valid,env={...fakeCredentials}) {
  const calls=[]
  let time=stamp, active=0, peak=0
  const opts={env,now:()=>time,fetch:async resource=>{
    const url=new URL(resource)
    const call={kind:paths.get(url.pathname),chain:url.searchParams.get('chains'),address:url.searchParams.get('address'),q:url.searchParams}
    assert.equal(url.origin,'https://web3.okx.com')
    assert(call.kind)
    calls.push(call)
    active++
    peak=Math.max(active,peak)
    try { await nextTurn(); return await reply(call) } finally { active-- }
  }}
  return {opts,calls,advance:ms=>{time+=ms},peak:()=>peak}
}
const portfolio=(f,addresses=subjects)=>handlePortfolio(new URLSearchParams({subjects:addresses.join(',')}),f.opts)
const quote=(f,amount='12345',from='WOKB')=>handleQuote(new URLSearchParams({from,amount}),f.opts)
const byChain=result=>Object.fromEntries(result.body.networks.map(n=>[n.chainIndex,n]))
const count=(f,kind)=>f.calls.filter(c=>c.kind===kind).length

test('four subjects return exact scoped decimals and identities with nine GETs and at most two in flight',async()=>{
  const f=fixture()
  const result=await portfolio(f)
  assert.equal(result.status,200)
  const {body}=result
  assert.equal(body.schema,'peridot.okx-portfolio/v1')
  assert.equal(body.source,'OKX Onchain OS')
  assert.equal(body.credentials,'present')
  assert.equal(body.requestedAt,new Date(stamp).toISOString())
  assert.equal(body.networks.length,4)
  const nets=byChain(result)
  for (const id of chains) {
    const n=nets[id]
    assert.equal(n.address,id==='501'?sol:getAddress(evm))
    assert.equal(n.status,'ok')
    assert.equal(n.reason,null)
    assert.equal(n.walletUsd,walletUsd)
    assert.equal(n.walletUsdScope,'wallet-tokens')
    assert.equal(n.requestedAt,body.requestedAt)
    assert.equal(n.receivedAt,body.requestedAt)
    assert.deepEqual(n.tokens,[{tokenAddress:id==='501'?mint:getAddress(asset),
      symbol:'SYN',balance,rawBalance,priceUsd:null,isNative:false}])
  }
  assert.equal(f.calls.length,9)
  assert.equal(count(f,'chains'),1)
  assert.equal(count(f,'inventory'),4)
  assert.equal(count(f,'usd'),4)
  assert(f.calls.filter(x=>x.kind==='usd').every(c=>c.q.get('assetType')==='1'))
  assert(f.peak()<=2)
})

test('fixed 400 bodies reject bad inputs including five subjects without spending a provider request',async()=>{
  const f=fixture()
  for (const input of [[],[...subjects,'1:'+asset],['1:'+evm,'1:'+getAddress(evm)],['1952:'+evm],
    ['501:111'],['501:'+base58.encode(new Uint8Array(33).fill(3))],['1:'+asset.slice(2)],['1:'+evm+':more'],
    ['501:FixtureApiKeyA6'], ['1:'+evm+',' ]]) {
    const r=await portfolio(f,input)
    assert.equal(r.status,400)
    assert.deepEqual(r.body,{error:'Invalid request'})
  }
  for (const [amount,from] of [['0','WOKB'], ['1e8','WOKB'], ['1.23','USDC'],['1','USDG'], [(2n**256n).toString(),'WOKB']]) {
    const r=await quote(f,amount,from)
    assert.equal(r.status,400)
    assert.deepEqual(r.body,{error:'Invalid request'})
  }
  for (const [handler,params] of [
    [handlePortfolio,new URLSearchParams([['subjects',subjects[1]],['subjects',subjects[1]]])],
    [handlePortfolio,new URLSearchParams({subjects:subjects[0],url:'https://synthetic.invalid/path'})],
    [handleQuote,new URLSearchParams([['from','WOKB'],['amount','10'],['amount','20']])],
    [handleQuote,new URLSearchParams({from:'WOKB',amount:'1',chainId:'1'})],
  ]) assert.deepEqual(await handler(params,f.opts),{status:400,body:{error:'Invalid request'}})
  assert.equal(f.calls.length,0)
})

test('missing credentials preserve all requested networks as unavailable and never call the provider',async()=>{
  const f=fixture(valid,{})
  const r=await portfolio(f)
  assert.equal(r.status,200)
  assert.equal(r.body.credentials,'missing')
  assert.equal(r.body.networks.length,4)
  for (const n of r.body.networks) {
    assert.equal(n.status,'unavailable')
    assert.equal(n.reason,'credentials-missing')
    assert.equal(n.walletUsd,null)
  }
  const q=await quote(f)
  assert.equal(q.body.status,'unavailable')
  assert.equal(q.body.reason,'credentials-missing')
  assert.equal(q.body.amountOut,null)
  assert.equal(f.calls.length,0)
})

test('a single response can contain unsupported, empty, not-entitled and token-bearing networks',async()=>{
  const f=fixture(call=>{
    if (call.kind==='chains') return ok(['1','8453','501'].map(chainIndex=>({chainIndex})))
    if (call.chain==='8453' && call.kind==='usd') return fail(403)
    if (call.chain==='1' && call.kind==='inventory') return ok([{tokenAssets:[]}])
    if (call.chain==='1' && call.kind==='usd') return ok([{totalValue:'0'}])
    return valid(call)
  })
  const r=await portfolio(f)
  assert.equal(r.status,200)
  const n=byChain(r)
  assert.equal(n['1'].status,'empty')
  assert.equal(n['1'].walletUsd,'0')
  assert.equal(n['196'].status,'unsupported')
  assert.equal(n['8453'].status,'not-entitled')
  assert.equal(n['501'].status,'ok')
  assert(!f.calls.some(c=>c.chain==='196'))
})

test('HTTP and provider entitlement failures are per-network, never provider messages',async()=>{
  for (const [httpStatus,code] of [[401,'50103'],[403,'50103'],[200,'50103']]) {
    const f=fixture(c=>c.kind==='inventory'?fail(httpStatus,code,'private diagnostic from upstream'):valid(c))
    const n=(await portfolio(f,[subjects[0]])).body.networks[0]
    assert.equal(n.status,'not-entitled')
    assert.equal(n.walletUsd,null)
    assert.equal(count(f,'inventory'),1)
    assert(!JSON.stringify(n).includes('private diagnostic'))
  }
})

test('native markers require the provider marker and the chain’s symbol; missing raw units and a zero price keep their meanings',async()=>{
  const symbols={'1':'ETH','196':'OKB','8453':'ETH','501':'SOL'}
  const f=fixture(c=>c.kind==='inventory'?ok([{tokenAssets:[token(c,{tokenContractAddress:'',symbol:symbols[c.chain],rawBalance:'',tokenPrice:'0'})]}]):valid(c))
  const nets=byChain(await portfolio(f))
  for (const id of chains) {
    assert.equal(nets[id].status,'ok')
    assert.deepEqual(nets[id].tokens,[{tokenAddress:null,symbol:symbols[id],balance,rawBalance:null,priceUsd:'0',isNative:true}])
  }
  for (const change of [{tokenContractAddress:'',symbol:'ETH'},{tokenContractAddress:'0x0000000000000000000000000000000000000000',symbol:'OKB'}]) {
    const bad=fixture(c=>c.kind==='inventory'?ok([{tokenAssets:[token(c,change)]}]):valid(c))
    const n=(await portfolio(bad,[subjects[0]])).body.networks[0]
    assert.equal(n.status,'unavailable')
    assert.equal(n.reason,'native-marker-unverified')
  }
})

test('portfolio cache normalizes EVM case and subject order while preserving observation times',async()=>{
  const f=fixture()
  const old=await portfolio(f)
  f.advance(59_999)
  const cached=await portfolio(f,[...subjects].reverse().map(x=>x.replace(evm,getAddress(evm))))
  assert.equal(f.calls.length,9)
  assert.deepEqual(byChain(cached),byChain(old))
  assert.equal(cached.body.requestedAt,old.body.requestedAt)
  f.advance(2)
  const next=await portfolio(f)
  assert.equal(f.calls.length,17)
  assert.notEqual(next.body.requestedAt,old.body.requestedAt)
  assert.equal(count(f,'chains'),1)
  f.advance(86_400_001)
  await portfolio(f)
  assert.equal(count(f,'chains'),2)
})

test('a failed supported-chain check is held for one minute, then retried once (Claude, D25 review)',async()=>{
  const f=fixture(c=>c.kind==='chains'?fail(503):valid(c))
  const first=await portfolio(f,[subjects[0]])
  f.advance(30_000)
  const second=await portfolio(f,[subjects[1]])
  for (const r of [first,second]) assert.equal(r.body.networks[0].status,'unavailable')
  assert.equal(count(f,'chains'),1)
  assert.equal(count(f,'inventory'),0)
  f.advance(31_000)
  await portfolio(f,[subjects[2]])
  assert.equal(count(f,'chains'),2)
})

test('Solana owner and mint case survive the round trip, and distinct valid casing has a separate cache key',async()=>{
  const altered=sol.replace(/[a-km-z]/,s=>s.toUpperCase())
  assert.notEqual(sol,altered)
  assert.equal(base58.decode(altered).length,32)
  const f=fixture()
  const a=(await portfolio(f,['501:'+sol])).body.networks[0]
  const b=(await portfolio(f,['501:'+altered])).body.networks[0]
  assert.deepEqual([a.address,b.address],[sol,altered])
  assert.deepEqual([a.tokens[0].tokenAddress,b.tokens[0].tokenAddress],[mint,mint])
  assert.equal(count(f,'inventory'),2)
})

test('quotes bind token identities and unsigned integer strings and retain observations for 15 seconds',async()=>{
  const f=fixture()
  const first=await quote(f)
  assert.equal(first.status,200)
  assert.deepEqual(first.body,{schema:'peridot.okx-quote/v1',status:'ok',reason:null,chainId:196,tokenIn:pair.WOKB,amountIn:'12345',
    tokenOut:pair.USDC,amountOut:'12345678901234567890',observedAt:new Date(stamp).toISOString()})
  f.advance(14_999)
  assert.deepEqual(await quote(f),first)
  assert.equal(count(f,'quote'),1)
  f.advance(2)
  assert.notEqual((await quote(f)).body.observedAt,first.body.observedAt)
  const reverse=await quote(f,'12345','USDC')
  assert.equal(reverse.body.tokenOut,pair.WOKB)
  assert.equal(count(f,'quote'),3)
})

test('429 and 5xx use at most two attempts and cannot turn provider failures into empty holdings',async()=>{
  for (const [status,expected] of [[429,'rate-limited'],[503,'unavailable']]) {
    const f=fixture(c=>c.kind==='inventory'?fail(status):valid(c))
    const n=(await portfolio(f,[subjects[0]])).body.networks[0]
    assert.equal(n.status,expected)
    assert.equal(n.walletUsd,null)
    assert.equal(count(f,'inventory'),2)
  }
  let calls=0
  const f=fixture(c=>c.kind==='quote' && ++calls===1?fail(503):valid(c))
  assert.equal((await quote(f)).body.status,'ok')
  assert.equal(calls,2)
})

test('portfolio and quote share the rolling rate limit across independent calls',async()=>{
  const f=fixture()
  await portfolio(f,[subjects[0]])
  for(let i=1;i<=27;i++) assert.equal((await quote(f,String(i))).body.status,'ok')
  assert.equal(f.calls.length,30)
  assert.equal((await quote(f,'28')).body.status,'rate-limited')
  assert.equal((await portfolio(f,[subjects[1]])).body.networks[0].status,'rate-limited')
  assert.equal(f.calls.length,30)
  f.advance(60_001)
  assert.equal((await quote(f,'28')).body.status,'ok')
  assert.equal(f.calls.length,31)
})

test('the per-minute allowance counts a retry as a separate provider attempt',async()=>{
  let firstFailure=true
  const f=fixture(c=>{
    if(c.kind==='quote' && c.q.get('amount')==='29' && firstFailure) {
      firstFailure=false
      return fail(503)
    }
    return valid(c)
  })
  for(let i=1;i<=29;i++) assert.equal((await quote(f,String(i))).body.status,'ok')
  assert.equal(count(f,'quote'),30)
  assert.equal((await quote(f,'30')).body.status,'rate-limited')
  assert.equal(count(f,'quote'),30)
})

test('rotating injected credentials clears observations but preserves the instance request budget',async()=>{
  const f=fixture()
  for (let i=1;i<=29;i++) assert.equal((await quote(f,String(i))).body.status,'ok')
  const rotated={opts:{...f.opts,env:{...fakeCredentials,OKX_API_KEY:'ReplacementSyntheticA6'}}}
  assert.equal((await quote(rotated,'1')).body.status,'ok')
  assert.equal(f.calls.length,30)
  assert.equal((await quote(rotated,'30')).body.status,'rate-limited')
  assert.equal(f.calls.length,30)
})

test('separate concurrent handler invocations respect a common provider concurrency limit',async()=>{
  const f=fixture()
  // Route handler calls can reconstruct the options object from stable instance dependencies.
  const opts=()=>({opts:{...f.opts}})
  const results=await Promise.all([portfolio(opts(),[subjects[0],subjects[1]]),portfolio(opts(),[subjects[2],subjects[3]]),quote(opts(),'31'),quote(opts(),'32')])
  assert(results.every(r=>r.status===200))
  assert(f.peak()<=2)
  assert.equal(count(f,'chains'),1)
})

test('malformed provider envelopes, identity and amounts fail closed',async()=>{
  for (const bad of [
    ()=>new Response('{',{status:200}),
    ()=>ok([{tokenAssets:'unexpected'}]),
    c=>ok([{tokenAssets:[token(c,{address:asset})]}]),
    c=>ok([{tokenAssets:[token(c,{balance:'1e20'})]}]),
    c=>ok([{tokenAssets:[token(c,{balance:9_007_199_254_740_992})]}]),
  ]) {
    const f=fixture(c=>c.kind==='inventory'?bad(c):valid(c))
    const n=(await portfolio(f,[subjects[1]])).body.networks[0]
    assert.equal(n.status,'unavailable')
    assert.equal(n.walletUsd,null)
  }
  const f=fixture(c=>c.kind==='quote'?ok([{chainIndex:'196',fromToken:{tokenContractAddress:pair.WOKB},toToken:{tokenContractAddress:pair.USDC},fromTokenAmount:'12345',toTokenAmount:3}]):valid(c))
  const q=await quote(f)
  assert.equal(q.body.status,'unavailable')
  assert.equal(q.body.amountOut,null)
})

test('a hostile token symbol is replaced without discarding its balance or other valid assets',async()=>{
  const other = '0x0000000000000000000000000000000000000005'
  const f=fixture(c=>c.kind==='inventory'?ok([{tokenAssets:[
    token(c),token(c,{tokenContractAddress:other,symbol:fakeCredentials.OKX_API_KEY,balance:'3',rawBalance:null}),
  ]}]):valid(c))
  const result=await portfolio(f,[subjects[1]])
  const n=result.body.networks[0]
  assert.equal(n.status,'ok')
  assert.equal(n.tokens.length,2)
  assert.deepEqual(n.tokens.find(t=>t.tokenAddress===other),
    {tokenAddress:other,symbol:'UNKNOWN',balance:'3',rawBalance:null,priceUsd:null,isNative:false})
  assert.equal(n.tokens.find(t=>t.tokenAddress===getAddress(asset)).symbol,'SYN')
  assert(!JSON.stringify(result).includes(fakeCredentials.OKX_API_KEY))
})

test('fake signing material, provider URLs, raw exceptions and diagnostic headers never escape',async t=>{
  const forbidden=[...Object.values(fakeCredentials),'https://synthetic.invalid/path','OK-ACCESS-SIGN','provider-private-diagnostic']
  const detail=forbidden.join(' ')
  const output=[]
  for(const method of ['log','warn','error','debug','info','trace']) t.mock.method(console,method,(...args)=>output.push(args.map(String).join(' ')))
  const responses=[]
  const cases=[
    ()=>{throw Error(detail)},
    ()=>fail(403,'50103',detail),
    ()=>Response.json({code:'0',data:[],msg:detail},{headers:{'x-error':detail}}),
    // A credential can fit the allowed token-symbol grammar. Do not trust a successful response.
    c=>ok([{tokenAssets:[token(c,{symbol:fakeCredentials.OKX_API_KEY,providerUrl:detail})]}]),
    c=>ok([{tokenAssets:[token(c,{symbol:'https://synthetic.invalid/path'})]}]),
    c=>ok([{tokenAssets:[token(c,{symbol:'OK-ACCESS-SIGN'})]}]),
  ]
  for(const bad of cases) {
    const f=fixture(c=>c.kind==='chains'?valid(c):bad(c))
    await assert.doesNotReject(async()=>{
      responses.push(await portfolio(f,[subjects[1]]),await quote(f))
    })
  }
  const emitted=JSON.stringify({responses,output})
  for(const marker of forbidden) assert(!emitted.includes(marker),'private fixture appeared in a response or console call')
})

test('the two physical attempts per subject include retries, including on a four-subject refresh', async () => {
  const tried = new Set()
  const f = fixture(c => {
    if (c.kind === 'inventory' && !tried.has(c.chain)) {
      tried.add(c.chain)
      return fail(503)
    }
    return valid(c)
  })
  const response = await portfolio(f)
  assert.equal(f.calls.length, 9)
  assert.equal(count(f,'inventory'), 8)
  assert.equal(count(f,'usd'), 0)
  for (const row of response.body.networks) {
    assert.equal(row.status,'rate-limited')
    assert.equal(row.walletUsd,null)
  }
  const g = fixture(c => c.kind === 'usd' ? fail(503) : valid(c))
  const subtotalFailure = await portfolio(g,[subjects[0]])
  assert.equal(subtotalFailure.body.networks[0].status,'unavailable')
  assert.equal(count(g,'usd'),1)
  assert.equal(g.calls.length,3)
})
