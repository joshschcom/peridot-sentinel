import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { decodeFunctionResult, encodeFunctionData, formatUnits, getAddress, keccak256, parseAbi } from 'viem'

const relative = name => new URL(name, import.meta.url)
const directory = JSON.parse(await readFile(relative('chainlink-directory.json'), 'utf8'))
const networks = [
  { id: 196, url: 'https://rpc.xlayer.tech', block: 76847921, hash: '0x6a506032748daf2c979031666cf81474e03c4d35f98d9054709aef77aa7a23b3' },
  { id: 1952, url: 'https://testrpc.xlayer.tech', block: 47158121, hash: '0xadf3e7abe2c345b5ecd4a6b1a974d31d5780269a688278c42cf2f0fa0faf5d49' },
]
const assets = {
  196: {
    'Circle native USDC': '0xB6CEceAB302E2E4948951eE7843FC24E92933061',
    'USDC bridged from Ethereum': '0x74b7f16337b8972027f6196a17a631ac6de26d22',
    'Legacy bridged USDC.e': '0xA8CE8aee21bC2A48a5EF670afCc9274C7bbbC035',
    'USDT0 OFT': '0x779Ded0c9e1022225f8E0630b35a9b54bE713736',
    'Legacy wrapped USDT': '0x1E4a5963aBFD975d8c9021ce480b42188849D41d',
    'Paxos USDG': '0x4ae46a509F6b1D9056937BA4500cb143933D2dc8',
    'Wrapped OKB': '0xe538905cf8410324e03A5A23C1c177a474D59b2b',
  },
  1952: {
    'Circle testnet USDC': '0xDec90b78111Ba2fc6FC6d84d8B9ec159A2d4b9B3',
    'Paxos testnet USDG': '0xF0863D7A29a55d0c4263c11bFac754312ff078DF',
  },
}
const supra = {
  196: ['0xe41444462709484272F54371F3f53bBF900Ec49E', '0x3E5E89d14576cE9f20a8347aA682517fe65B4ACB'],
  1952: ['0xF8522B7fcE37439b98A2be282d413A44269028bE', '0x39d5cdB131f73c76cefac04556Fa0F75689200dA'],
}
const abi = parseAbi([
  'function name() view returns (string)', 'function symbol() view returns (string)',
  'function decimals() view returns (uint8)', 'function description() view returns (string)',
  'function aggregator() view returns (address)', 'function typeAndVersion() view returns (string)',
  'function latestRoundData() view returns (uint80 roundId,int256 answer,uint256 startedAt,uint256 updatedAt,uint80 answeredInRound)',
  'function getSvalue(uint256 pair) view returns (uint256 round,uint256 decimals,uint256 time,uint256 price)',
])
let requestId = 0
async function rpc(net, method, params) {
  // No wallet, write method or latest-state fallback.
  assert(['eth_chainId','eth_getBlockByNumber','eth_getCode','eth_call','eth_getBalance'].includes(method))
  const response = await fetch(net.url, {
    method: 'POST', headers: {'content-type':'application/json'},
    body: JSON.stringify({jsonrpc:'2.0', id: ++requestId, method, params}), signal: AbortSignal.timeout(30000),
  })
  assert(response.ok, 'RPC HTTP ' + response.status)
  const { result, error } = await response.json()
  if (error) throw Error(JSON.stringify(error))
  assert.notEqual(result, undefined)
  return result
}
const tag = net => '0x' + net.block.toString(16)
async function code(net, address) {
  const runtime = await rpc(net, 'eth_getCode', [address, tag(net)])
  return {address: getAddress(address), bytes: (runtime.length-2)/2, keccak256: keccak256(runtime)}
}
async function call(net, address, functionName, args = []) {
  const data = encodeFunctionData({abi, functionName, args})
  const raw = await rpc(net,'eth_call',[{to:address, data},tag(net)])
  return {data, raw, decoded: decodeFunctionResult({abi,functionName,data:raw})}
}
async function inspect(net,address,methods) {
  const result = await code(net,address)
  if (result.bytes) {
    result.calls = Object.fromEntries(await Promise.all(methods.map(async name => [name,await call(net,address,name)])))
  }
  return result
}
async function feed(net, row, now) {
  const proxy = await inspect(net,row.proxyAddress,['description','decimals','aggregator','latestRoundData'])
  const aggregator = await inspect(net,row.contractAddress,['typeAndVersion'])
  if (!proxy.bytes) return {pair:row.name,proxy,aggregator}
  assert.equal(proxy.calls.aggregator.decoded.toLowerCase(),row.contractAddress.toLowerCase())
  assert.equal(proxy.calls.decimals.decoded,row.decimals)
  const [roundId,answer,startedAt,updatedAt,answeredInRound] = proxy.calls.latestRoundData.decoded
  const snapshot = {roundId, answer, startedAt, updatedAt, answeredInRound, ageSeconds:now-updatedAt}
  if (row.heartbeat) {
    snapshot.decimalPrice = formatUnits(answer,row.decimals)
    snapshot.withinDirectoryHeartbeat = answer > 0n && updatedAt > 0n && updatedAt <= now && now-updatedAt <= BigInt(row.heartbeat)
  }
  return {pair:row.name,proxy,aggregator,snapshot}
}
async function record(net) {
  const chain = await rpc(net,'eth_chainId',[])
  assert.equal(BigInt(chain),BigInt(net.id))
  const header = await rpc(net,'eth_getBlockByNumber',[tag(net),false])
  assert.equal(header.hash,net.hash)
  const now = BigInt(header.timestamp)
  const result = {chainId:net.id, rpc:net.url, blockNumber:net.block, blockHash:header.hash, timestamp:now, timestampISO:new Date(Number(now)*1000).toISOString(), assets:{}, chainlink:[]}
  for (const [label,address] of Object.entries(assets[net.id])) {
    result.assets[label] = await inspect(net,address,['name','symbol','decimals'])
  }
  for (const row of directory[net.id].selected) result.chainlink.push(await feed(net,row,now))
  const [pull,storage] = supra[net.id]
  result.supra = {pull:await code(net,pull),storage:await code(net,storage)}
  if (result.supra.storage.bytes) {
    result.supra.pairs = {}
    for (const [pair,index] of Object.entries({'USDT_USD':48,'USDC_USD':89,'OKB_USDT':148})) {
      result.supra.pairs[pair] = {index, ...await call(net,storage,'getSvalue',[BigInt(index)])}
    }
  }
  if (net.id===1952) {
    result.mainnetPriceProxiesOnTestnet = []
    for (const row of directory[196].selected) result.mainnetPriceProxiesOnTestnet.push({pair: row.name, ...await code(net,row.proxyAddress)})
    result.deployer = '0x8C1741a53d5FB97D74C1d105b0fbFbb4740d5D67'
    result.balanceWei = BigInt(await rpc(net,'eth_getBalance',[result.deployer,tag(net)]))
  }
  return result
}
const records = await Promise.all(networks.map(record))
const output = JSON.stringify(records,(_,val) => typeof val==='bigint' ? val.toString() : val,2)+'\n'
if (process.argv[2] === '--record') await writeFile(relative('rpc.json'),output)
else assert.equal(output,await readFile(relative('rpc.json'),'utf8'),'RPC replay differs from recorded evidence')
console.log(process.argv[2] === '--record' ? 'Recorded both pinned networks.' : 'Exact match for both pinned networks.')
