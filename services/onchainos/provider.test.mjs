import assert from 'node:assert/strict'
import {createHmac} from 'node:crypto'
import test from 'node:test'
import {createProvider} from './provider.mjs'
import {portfolioPlan, quotePlan} from './portfolio-prep/reads.mjs'

// Injected fixture object only. No test reads or changes the process environment.
const env = {OKX_API_KEY:'fixture-key-A4', OKX_API_SECRET:'fixture-secret-A4', OKX_API_PASSPHRASE:'fixture-pass-A4'}
const initial = Date.parse('2026-11-28T10:00:00.000Z')
const plan = quotePlan('WOKB', '1000000000000000000')
const [chains] = portfolioPlan([{chainIndex:'1', address:'0x0000000000000000000000000000000000000001',role:'watch'}])
const ok = () => Response.json({code:'0', data:[], msg:'ignored'})
const synthetic = (request, now=()=>initial) => createProvider({env, fetch:request, now})

test('signs only the canonical GET target; rejects altered origin, method and query before fetch', async () => {
  let calls = 0
  const provider = synthetic(async (url, options) => {
    calls++
    const timestamp = new Date(initial).toISOString()
    assert.equal(url, 'https://web3.okx.com' + plan.path)
    assert.equal(options.method,'GET')
    assert.equal(options.redirect,'error')
    assert.equal(options.cache,'no-store')
    assert.equal(options.headers['OK-ACCESS-TIMESTAMP'],timestamp)
    assert.equal(options.headers['OK-ACCESS-SIGN'],createHmac('sha256',env.OKX_API_SECRET).update(timestamp+'GET'+plan.path).digest('base64'))
    return ok()
  })
  for (const changes of [{origin:'https://other.invalid'}, {method:'POST'}, {path:'/api/v6/dex/other'}]) {
    assert.equal((await provider.read({...plan,...changes})).status,'unavailable')
  }
  assert.equal(calls,0)
  assert.deepEqual(await provider.read(plan),{status:'ok',body:{code:'0',data:[]}})
  assert.equal(calls,1)
})

test('limits overlapping HTTP calls to two and counts all attempts in a rolling minute', async () => {
  let time = initial
  let active = 0
  let peak = 0
  let calls = 0
  const request = async () => {
    calls++
    peak = Math.max(peak,++active)
    await new Promise(resolve=>setImmediate(resolve))
    active--
    return ok()
  }
  const now = ()=>time
  const provider = synthetic(request, now)
  const otherRoute = createProvider({env:{...env}, fetch:request, now})
  const batch = await Promise.all(Array.from({length:40},(_,i)=>(i%2 ? provider : otherRoute).read(plan)))
  assert.equal(peak,2)
  assert.equal(calls,30)
  assert.equal(batch.filter(x=>x.status==='rate-limited').length,10)
  time += 59999
  assert.equal((await provider.read(plan)).status,'rate-limited')
  time++
  assert.equal((await provider.read(plan)).status,'ok')
  assert.equal(calls,31)
})

test('429 and 5xx are retried once within budget; capabilities and long Retry-After do not retry', async () => {
  for (const [target,status,headers,expectedCalls] of [
    [plan,429,{},2], [plan,503,{},2], [plan,429,{'retry-after':'5'},1], [chains,503,{},1], [plan,403,{},1],
  ]) {
    let calls = 0
    const provider = synthetic(async () => { calls++; return new Response('test only',{status,headers}) })
    const result = await provider.read(target)
    assert.equal(calls,expectedCalls)
    assert.equal(result.status,status===429?'rate-limited':status===403?'not-entitled':'unavailable')
  }
  let calls = 0
  const provider = synthetic(async () => ++calls <= 29 ? ok() : new Response(null,{status:503}))
  for (let i=0;i<29;i++) await provider.read(plan)
  assert.equal((await provider.read(plan)).status,'rate-limited')
  assert.equal(calls,30)
})

test('handles documented application error codes without passing on provider text', async () => {
  for (const [code,status] of [['50030','not-entitled'], ['50120','not-entitled'], ['50125','not-entitled'], ['50114','not-entitled'],
    ['81104','unsupported'], ['82105','unsupported'], ['50011','rate-limited'], ['50001','unavailable']]) {
    const provider = synthetic(async()=>Response.json({code,msg:env.OKX_API_PASSPHRASE,data:null}))
    const result = await provider.read(plan)
    assert.equal(result.status,status)
    assert(!JSON.stringify(result).includes(env.OKX_API_PASSPHRASE))
  }
})

test('malformed, truncated and oversized bodies plus thrown fetch failures return fixed reasons', async () => {
  // Each failure point has its own fixed code (D26 review); none carries provider text or a credential.
  for (const [response, reason] of [
    [() => new Response('broken '+env.OKX_API_KEY), 'malformed-json'],
    [() => Response.json({code:'0',data:env.OKX_API_SECRET}), 'malformed-data'],
    [() => Response.json({code:7,data:[]}), 'malformed-code'],
    [() => new Response('x'.repeat(8*1024*1024+1)), 'malformed-too-large'],
    [() => new Response(Uint8Array.of(255,255)), 'malformed-json'],
  ]) {
    assert.deepEqual(await synthetic(response).read(plan),{status:'unavailable',reason})
  }
  const bad = await synthetic(()=>{throw Error(env.OKX_API_SECRET)}).read(plan)
  assert.deepEqual(bad,{status:'unavailable',reason:'provider-unavailable'})
})
