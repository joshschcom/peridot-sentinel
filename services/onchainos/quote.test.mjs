import {test} from 'node:test'
import assert from 'node:assert/strict'
import {pair,quote} from './quote.mjs'
const env={OKX_API_KEY:'fixture',OKX_API_SECRET:'fixture',OKX_API_PASSPHRASE:'fixture'}
test('requires credentials and a fixed route',async()=>{
  await assert.rejects(quote('WOKB','100',{env:{}}),/credentials unavailable/)
  await assert.rejects(quote('other','100',{env}),/Expected/)
  await assert.rejects(quote('WOKB',100,{env}),/Expected/)
})
test('quotes only matching route and strips untrusted response fields',async()=>{
  const row={chainIndex:'196',fromToken:{tokenContractAddress:pair.WOKB},toToken:{tokenContractAddress:pair.USDC},
    fromTokenAmount:'100',toTokenAmount:'8',tx:{data:'0xff'}}
  const request=async(url,options)=>{
    assert.equal(new URL(url).hostname,'web3.okx.com')
    assert.equal(options.method,'GET')
    return Response.json({code:'0',data:[row]})
  }
  const result=await quote('WOKB','100',{env,request})
  assert.equal(result.amountOut,'8')
  assert(!('tx' in result))
  row.fromTokenAmount='101'
  await assert.rejects(quote('WOKB','100',{env,request}),/mismatched route/)
})
