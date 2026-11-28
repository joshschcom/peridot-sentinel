import assert from 'node:assert/strict'
import {createServer} from 'node:http'
import {spawnSync} from 'node:child_process'
import {mkdtemp,writeFile,symlink,readFile,rm} from 'node:fs/promises'
import {join} from 'node:path'
import {once} from 'node:events'
import test from 'node:test'
import {subjects,verifyLive} from './verify-live.mjs'
import {pair} from './quote.mjs'
import {handlePortfolio} from './reader.mjs'

const time = Date.parse('2026-11-28T12:00:00.000Z')
const iso = new Date(time).toISOString()
const blockHash = '0x'+'a'.repeat(64)
const lamports = 9007199254740993n
const host = 'app.test'

function portfolio(watch) {
  const amount = watch.chainIndex === '501' ? '9007199.254740993' : '1'
  return {schema:'peridot.okx-portfolio/v1',source:'OKX Onchain OS',credentials:'present',requestedAt:iso,
    networks:[{chainIndex:watch.chainIndex,address:watch.address,status:'ok',reason:null,requestedAt:iso,receivedAt:iso,
      tokens:[{tokenAddress:null,symbol:watch.symbol,balance:amount,rawBalance:null,priceUsd:null,isNative:true}],
      walletUsd:'123.45',walletUsdScope:'wallet-tokens'}]}
}
function quote() {
  return {schema:'peridot.okx-quote/v1',chainId:196,status:'ok',reason:null,tokenIn:pair.WOKB,amountIn:'1000000000000000000',
    tokenOut:pair.USDC,amountOut:'1000000',observedAt:iso}
}
async function run(t, alter=()=>{}) {
  const seen = {valid:0,invalid:0,quotes:0,rpc:0,providerCallsForInvalid:0}
  const server = createServer(async(req,res)=>{
    const url = new URL(req.url,'http://stub.invalid')
    let body, status = 200
    const remote = req.headers['x-test-service']
    if (remote === host) {
      if (url.pathname.endsWith('/quote')) {
        assert.equal(url.searchParams.get('from'),'WOKB')
        assert.equal(url.searchParams.get('amount'),'1000000000000000000')
        seen.quotes++
        body=quote()
      } else {
        assert.equal(url.pathname,'/api/onchainos/portfolio')
        const [id,addr]=url.searchParams.get('subjects').split(':')
        const watch=subjects.find(s=>s.chainIndex===id)
        if (watch) {
          assert.equal(addr,watch.address)
          seen.valid++
          body=portfolio(watch)
        } else {
          seen.invalid++
          const denied=await handlePortfolio(url.searchParams,{
            env:{OKX_API_KEY:'synthetic-key',OKX_API_SECRET:'synthetic-secret',OKX_API_PASSPHRASE:'synthetic-phrase'},
            now:()=>time,fetch:()=>{seen.providerCallsForInvalid++;throw Error('Unexpected provider call')},
          })
          status=denied.status
          body=denied.body
        }
      }
      alter({body,remote})
      res.writeHead(status,{'content-type':'application/json'})
      res.end(JSON.stringify(body))
      return
    }
    const watch=subjects.find(s=>new URL(s.rpc).hostname===remote)
    assert(watch)
    seen.rpc++
    const chunks=[]
    for await(const chunk of req) chunks.push(chunk)
    const call=JSON.parse(Buffer.concat(chunks).toString())
    const [a,b] = call.params
    let result
    switch(call.method) {
      case 'eth_chainId': result='0x'+BigInt(watch.chainIndex).toString(16); break
      case 'eth_getBlockByNumber':
        assert(['latest','0x10'].includes(a)); result={number:'0x10',hash:blockHash}; break
      case 'eth_getBalance':
        assert.equal(a,watch.address); assert.equal(b,'0x10')
        result='0x'+(10n**18n+1n).toString(16); break
      case 'getGenesisHash': result='5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d'; break
      case 'getBalance':
        assert.equal(a,watch.address); assert.deepEqual(b,{commitment:'finalized'})
        result={context:{slot:123},value:'BIGINT_LAMPORTS'}; break
      default: throw Error('Unexpected method')
    }
    body={jsonrpc:'2.0',id:call.id,result}
    alter({body,remote,call})
    res.writeHead(200,{'content-type':'application/json'})
    res.end(JSON.stringify(body).replace('"BIGINT_LAMPORTS"',String(lamports)))
  })
  server.listen(0,'127.0.0.1')
  await once(server,'listening')
  t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections()}))
  const stub='http://127.0.0.1:'+server.address().port
  const report = await verifyLive('https://'+host,{now:()=>time,fetch:(target,init)=>{
    const url = new URL(target)
    // All transport, including fixed independent RPC URLs, terminates at this local server.
    return fetch(stub+url.pathname+url.search,{...init,headers:{...init.headers,'x-test-service':url.hostname}})
  }})
  return {report,seen}
}

test('four scoped app reads against pinned independent RPCs, exact u64 lamports, quote and invalid route',async t=>{
  const {report,seen}=await run(t)
  assert.equal(seen.valid,4)
  assert.equal(seen.invalid,1)
  assert.equal(seen.providerCallsForInvalid,0)
  assert.equal(seen.quotes,1)
  assert.equal(seen.rpc,14)
  assert.deepEqual(report.verifiedChainIndices,['196','1','8453','501'])
  assert.equal(report.networks[0].comparison.differenceRaw,'1')
  assert.equal(report.networks[0].independent.observation.block,'16')
  assert.equal(report.networks[3].independent.observation.nativeRaw,String(lamports))
  assert.equal(report.networks[3].independent.observation.slot,'123')
  assert.equal(report.quote.verified,true)
  assert.equal(report.invalidInput.httpStatus,400)
  assert.equal(report.invalidInput.result.providerCalls,'not-observable-over-http')
  assert(report.checksPassed)
})

test('disagreement, stale data, unsupported chain and unavailable RPC are distinguished',async t=>{
  const {report}=await run(t,({body,remote,call})=>{
    const net=body.networks?.[0]
    if(net?.chainIndex==='196') net.tokens[0].balance='2'
    if(net?.chainIndex==='1') {net.status='unsupported';net.reason='unsupported-chain';net.tokens=[];net.walletUsd=null}
    if(net?.chainIndex==='8453') net.requestedAt=net.receivedAt='2026-01-01T00:00:00.000Z'
    if(call?.method==='getGenesisHash') body.result='wrong-network'
  })
  assert.deepEqual(report.networks.map(n=>n.comparison.status),['disagree','unverified','stale','unverified'])
  assert.equal(report.networks[1].app.result.reason,'unsupported-chain')
  assert.equal(report.networks[3].independent.observation,null)
  assert.equal(report.checksPassed,false)
})

test('sanitization scans every route body, strips credential shapes and rejects unknown fields',async t=>{
  const credential='AB123456-1234-1234-1234-123456789012'
  const {report}=await run(t,({body})=>{
    if(body.networks?.[0].chainIndex==='196') body.networks[0].tokens[0].symbol=credential
    if(body.networks?.[0].chainIndex==='501') body.networks[0].debug='unreviewed output'
    if(body.schema==='peridot.okx-quote/v1') body.tokenOut=pair.WOKB
    if(body.error) body.error='OK-ACCESS-PASSPHRASE echoed'
  })
  assert.equal(report.networks[0].app.bodyCheck,'sensitive-pattern')
  assert.equal(report.networks[3].app.bodyCheck,'invalid')
  assert.equal(report.quote.verified,false)
  assert.equal(report.invalidInput.bodyCheck,'sensitive-pattern')
  assert.equal(report.sanitizedBodies,false)
  assert(!JSON.stringify(report).includes(credential))
  assert(!JSON.stringify(report).includes('OK-ACCESS-PASSPHRASE'))
  assert(!JSON.stringify(report).includes('unreviewed output'))
})

test('incorrect raw vs displayed amount, missing native, duplicate native and malformed timestamp fail acceptance',async t=>{
  const {report}=await run(t,({body})=>{
    const n=body.networks?.[0]
    if(n?.chainIndex==='196') n.tokens[0].rawBalance='1'
    if(n?.chainIndex==='1') n.tokens=[{...n.tokens[0],isNative:false,tokenAddress:subjects[1].address}]
    if(n?.chainIndex==='8453') n.tokens.push({...n.tokens[0]})
    if(n?.chainIndex==='501') n.receivedAt='wrong'
  })
  assert.deepEqual(report.verifiedChainIndices,[])
  assert.equal(report.networks[1].app.bodyCheck,'verified')
  assert.equal(report.networks[1].app.result.nativeRaw,null)
  assert.equal(report.networks[1].comparison.status,'unverified')
  assert.equal(report.checksPassed,false)
})

test('the command accepts an HTTPS origin without URL credentials, paths or queries', async()=>{
  for(const url of ['http://app.test','https://app.test/path','https://app.test/?key=x','https://name:secret@app.test']) {
    await assert.rejects(verifyLive(url,{fetch:()=>assert.fail('unexpected fetch')}),/Invalid observation/)
  }
})

test('CLI refuses an existing evidence file or a symlink before making a network request',async t=>{
  const dir=await mkdtemp('services/onchainos/.verify-test-')
  t.after(()=>rm(dir,{recursive:true,force:true}))
  const filepath=join(dir,'1952.json'), alias=join(dir,'alias.json')
  await writeFile(filepath,'existing evidence')
  await symlink('1952.json',alias)
  const disableNetwork='data:text/javascript,'+encodeURIComponent('globalThis.fetch=()=>process.exit(42)')
  for(const out of [filepath,alias]) {
    const result=spawnSync(process.execPath,['--import',disableNetwork,'services/onchainos/verify-live.mjs',
      '--base-url=https://verification.invalid','--out='+out],{encoding:'utf8'})
    assert.equal(result.status,1)
    assert.equal(result.stdout,'')
    assert.match(result.stderr,/new output file/)
    assert.equal(await readFile(filepath,'utf8'),'existing evidence')
  }
})
