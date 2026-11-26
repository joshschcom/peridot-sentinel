// Server-side, informational quote only. Returns a fixed schema of amounts and asset identities.
import {createHmac} from 'node:crypto'
import {pathToFileURL} from 'node:url'

const origin='https://web3.okx.com'
export const pair=Object.freeze({
  WOKB:'0xe538905cf8410324e03a5a23c1c177a474d59b2b',
  USDC:'0xb6ceceab302e2e4948951ee7843fc24e92933061',
})
export async function quote(from,amount,{env=process.env,request=fetch}={}) {
  if (!Object.hasOwn(pair,from) || typeof amount !== 'string' || !/^[1-9]\d{0,77}$/.test(amount) || BigInt(amount)>=2n**256n)
    throw Error('Expected WOKB or USDC and a positive raw token amount')
  const key=env.OKX_API_KEY, secret=env.OKX_API_SECRET, passphrase=env.OKX_API_PASSPHRASE
  if (!key || !secret || !passphrase) throw Error('OnchainOS credentials unavailable')
  const to=from==='WOKB'?'USDC':'WOKB'
  const path='/api/v6/dex/aggregator/quote?'+new URLSearchParams({
    chainIndex:'196',fromTokenAddress:pair[from],toTokenAddress:pair[to],amount,
  })
  for (let attempt=0;attempt<3;attempt++) {
    const ts=new Date().toISOString()
    let response
    try {
      response=await request(origin+path,{method:'GET',redirect:'error',signal:AbortSignal.timeout(6000),headers:{
        'OK-ACCESS-KEY':key,'OK-ACCESS-PASSPHRASE':passphrase,'OK-ACCESS-TIMESTAMP':ts,
        'OK-ACCESS-SIGN':createHmac('sha256',secret).update(ts+'GET'+path).digest('base64'),
      }})
    } catch {
      if (attempt===2) throw Error('Quote service unavailable')
    }
    if (response?.ok) {
      const body=await response.json()
      const row=body.data?.[0]
      if (String(body.code)!=='0' || !row || String(row.chainIndex)!=='196' ||
        row.fromToken?.tokenContractAddress?.toLowerCase()!==pair[from] || row.toToken?.tokenContractAddress?.toLowerCase()!==pair[to] ||
        row.fromTokenAmount!==amount || !/^[1-9]\d*$/.test(row.toTokenAmount))
        throw Error('Quote unavailable or mismatched route')
      return {source:'OKX OnchainOS',chainId:196,tokenIn:pair[from],amountIn:amount,tokenOut:pair[to],amountOut:row.toTokenAmount,observedAt:ts}
    }
    if (response && response.status!==429 && response.status<500) throw Error('Quote service rejected credentials or parameters')
    if (attempt<2) await new Promise(r=>setTimeout(r,200*(attempt+1)))
  }
  throw Error('Quote service unavailable')
}
if (process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  try { console.log(JSON.stringify(await quote(process.argv[2],process.argv[3]))) }
  catch(e) { console.error(e.message);process.exitCode=1 }
}
