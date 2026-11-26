// Read-only public RPC and unauthenticated official provider probes.
const address = '0xEB32e6bA03D8B92d6bB0d5283A59263a50674BC0'
const from = 47161508
const results = []
for(const endpoint of ['https://testrpc.xlayer.tech','https://xlayertestrpc.okx.com','https://testrpc.xlayer.tech/terigon','https://xlayertestrpc.okx.com/terigon']) {
  for(const count of [100,101,102,3000]) {
    const filter={address,fromBlock:'0x'+from.toString(16),toBlock:'0x'+(from+count-1).toString(16)}
    const response=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({
      jsonrpc:'2.0',id:1,method:'eth_getLogs',params:[filter],
    }),signal:AbortSignal.timeout(8000)})
    const result=await response.json()
    results.push({endpoint,fromBlock:from,blocksInclusive:count,status:response.status,result:result.error??{logCount:result.result.length}})
  }
}
for(const name of ['by-address','by-block-and-address']) {
  const query=new URLSearchParams({chainShortName:'XLAYER_TESTNET',address})
  if(name==='by-block-and-address') {query.set('startBlockHeight',String(from));query.set('endBlockHeight',String(from+3000))}
  const target='https://web3.okx.com/api/v5/xlayer/log/'+name+'?'+query
  const response=await fetch(target,{signal:AbortSignal.timeout(8000)})
  results.push({endpoint:target,authentication:'none',status:response.status,result:await response.json()})
}
console.log(JSON.stringify({observedAt:new Date().toISOString(),contract:address,results},null,2))
