import assert from 'node:assert/strict'
import {readFile, writeFile} from 'node:fs/promises'
import {decodeFunctionResult,encodeFunctionData,keccak256,parseAbi,formatUnits} from 'viem'
const abi = parseAbi(['function verifyOracleProofV2(bytes proof) returns ((uint256[] pairs,uint256[] prices,uint256[] timestamp,uint256[] decimal,uint256[] round) info)'])
const networks = [
  ['mainnet',196,'https://rpc.xlayer.tech','0xe41444462709484272F54371F3f53bBF900Ec49E'],
  ['testnet',1952,'https://testrpc.xlayer.tech','0xF8522B7fcE37439b98A2be282d413A44269028bE'],
]
const relative = name => new URL(name,import.meta.url)
async function read(url,method,params) {
  assert(['eth_chainId','eth_getBlockByNumber','eth_call'].includes(method))
  const http = await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),signal:AbortSignal.timeout(30000)})
  assert(http.ok)
  const rpc = await http.json()
  if (rpc.error) {
    // Record an EVM execution rejection, never conflate RPC transport/provider faults with a verifier result.
    if (/revert/i.test(rpc.error.message)) return {reverted:true,code:rpc.error.code,message:rpc.error.message,data:rpc.error.data}
    throw Error(JSON.stringify(rpc.error))
  }
  return rpc.result
}
async function replay([label,chainId,rpc,contract], atSettlement) {
  const sample = JSON.parse(await readFile(relative('supra-'+label+'-proof.json'),'utf8'))
  assert.equal(Number(BigInt(await read(rpc,'eth_chainId',[]))),chainId)
  const pin = atSettlement ? sample.settlementCheck : sample
  const blockTag = '0x'+pin.blockNumber.toString(16)
  const header = await read(rpc,'eth_getBlockByNumber',[blockTag,false])
  assert.equal(header.hash,pin.blockHash)
  assert.equal(BigInt(header.timestamp),BigInt(pin.timestamp))
  const data = encodeFunctionData({abi,functionName:'verifyOracleProofV2',args:['0x'+sample.response.proof_bytes]})
  const result = await read(rpc,'eth_call',[{to:contract,data},blockTag])
  const record = {chainId,rpc,contract,observation:atSettlement ? 'five blocks later' : 'proof capture',blockNumber:pin.blockNumber,blockHash:pin.blockHash,blockTimestamp:pin.timestamp,
    method:'eth_call verifyOracleProofV2(bytes)',calldataKeccak256:keccak256(data),result}
  if (typeof result === 'string') {
    const info = decodeFunctionResult({abi,functionName:'verifyOracleProofV2',data:result})
    assert.deepEqual(info.pairs.map(Number).sort((a,b)=>a-b),sample.request.pair_indexes)
    record.verified = info.pairs.map((pair,i)=>({pair,price:info.prices[i],timestampMs:info.timestamp[i],decimals:info.decimal[i],
      round:info.round[i],decimalPrice:formatUnits(info.prices[i],Number(info.decimal[i])),
      ageMs:1000n*BigInt(pin.timestamp)-info.timestamp[i]}))
    const okbUsdt = record.verified.find(row=>row.pair===148n)
    const usdtUsd = record.verified.find(row=>row.pair===48n)
    const rawProduct = okbUsdt.price * usdtUsd.price
    const decimals = okbUsdt.decimals + usdtUsd.decimals
    record.derivedOkbUsd = {legs:[148,48],rawProduct,decimals,decimalPrice:formatUnits(rawProduct,Number(decimals))}
  }
  return record
}
const records = await Promise.all(networks.flatMap(net=>[replay(net,false),replay(net,true)]))
const json=JSON.stringify(records,(_,v)=>typeof v==='bigint'?v.toString():v,2)+'\n'
if (process.argv[2]==='--record') await writeFile(relative('supra-verifier.json'),json)
else assert.equal(json,await readFile(relative('supra-verifier.json'),'utf8'))
for (const r of records) console.log(r.chainId,r.blockNumber,JSON.stringify(r.verified??r.result,(_,v)=>typeof v==='bigint'?v.toString():v))
