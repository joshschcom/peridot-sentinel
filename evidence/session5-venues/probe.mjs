// Replay: node evidence/session5-venues/probe.mjs | cmp - evidence/session5-venues/observations.json
import assert from 'node:assert/strict';
import { createPublicClient, http, parseAbiItem, keccak256, getAddress } from 'viem';
const assets = {
  USDC: '0xB6CEceAB302E2E4948951eE7843FC24E92933061', WOKB: '0xe538905cf8410324e03A5A23C1c177a474D59b2b',
};
const addresses = {
  aaveProvider: '0xdFf435BCcf782f11187D3a4454d96702eD78e092', aavePool: '0xE3F3Caefdd7180F884c01E57f65Df979Af84f116',
  aaveData: '0x6C505C31714f14e8af2A03633EB2Cdfb4959138F', sparkUSDC: '0xf90E63079D97a0A1f479b2b168457F420CAFf6ba',
  sparkUSDT: '0xc358c90D32375721Cb3924320Fdc2F8B694347Ca', aaveStataUSDC: '0xEB809A8F20C210C6aaF0015926ab8d89F1742681',
  morpho: '0xeb00C490E888286357dC5B0a35D37D9260D11Ab5', morphoVaultV2Factory: '0x63D6eAc0d16D57dd131D9023ADb060277d3237d7',
  uniV4Manager: '0x360e68faccca8ca495c1b759fd9eee466db9fb32', uniV4StateView: '0x76fd297e2d437cd7f76d50f01afe6160f86e9990',
  uniV3Factory: '0x4B2ab38DBF28D31D467aA8993f6c2585981D6804', uniV3Router: '0x4f0c28f5926afda16bf2506d5d9e57ea190f9bca',
  uniV3Quoter: '0xd1b797d92d87b688193a2b976efc8d577d204343', uniV3Pool: '0x9f73888Fb725A3409548BC8d2e42365AC063E148',
  usdcFeed: '0xB8a08c178D96C315FbFB5661ABD208477391BC40', okbFeed: '0x4Ff345b18a2bF894F8627F41501FBf30d5C5e7BE',
  uptimeFeed: '0x45c2b8C204568A03Dc7A2E32B71D67Fe97F908A9',
};
const sources = {
  aave: 'https://github.com/aave-dao/aave-address-book/blob/6258193f6ddf06225a889aac7c356be3e31432c0/src/AaveV3XLayer.sol',
  aaveContracts: 'https://github.com/aave-dao/aave-v3-origin',
  spark: 'https://github.com/sparkdotfi/spark-address-registry/blob/28a6ef4eccb404313ae2b111f8ef04f4e2018183/src/XLayer.sol',
  sparkVault: 'https://github.com/sparkdotfi/spark-vaults-v2/blob/0a686ba/src/SparkVault.sol',
  sparkSavings: 'https://docs.spark.finance/products/spark-savings',
  morpho: 'https://github.com/morpho-org/sdks/blob/b6889cc5ed0a68d1f3e254ef7df7abd26a4a2612/packages/morpho-ts/src/addresses.ts',
  uniV3: 'https://developers.uniswap.org/docs/protocols/v3/deployments/v3-xlayer-deployments',
  uniV4: 'https://developers.uniswap.org/docs/protocols/v4/deployments',
  chainlink: 'https://reference-data-directory.vercel.app/feeds-ethereum-mainnet-xlayer-1.json',
  circle: 'https://developers.circle.com/stablecoins/usdc-contract-addresses',
  communityTestnet: 'https://github.com/RangePilot/RangePilot/blob/553e940edaf1f0afbe6485b50d63fc326fa66091/packages/contracts/deployments/xlayer-testnet.json',
};
async function map(record, fn) {
  return Object.fromEntries(await Promise.all(Object.entries(record).map(async ([k, v]) => [k, await fn(v)])));
}
async function open(id, url, number, hash) {
  const client = createPublicClient({transport:http(url,{batch:{batchSize:8, wait:25}})});
  const block = await client.getBlock({blockNumber:number});
  assert.equal(await client.getChainId(),id);
  assert.equal(block.hash,hash);
  const code = async address => {
    const bytes = await client.getCode({address,blockNumber:number}) ?? '0x';
    return {address:getAddress(address.toLowerCase()),bytes:(bytes.length-2)/2,hash:bytes==='0x'?null:keccak256(bytes)};
  };
  const read = (address, signature, args=[]) => {
    const fn = parseAbiItem('function ' + signature);
    return client.readContract({address:getAddress(address.toLowerCase()),abi:[fn],functionName:fn.name,args,blockNumber:number});
  };
  return {id,url,number,hash,timestamp:block.timestamp,UTC:new Date(Number(block.timestamp)*1000).toISOString(),code,read};
}
async function runMain() {
  const {code,read,...pin}=await open(196,'https://rpc.xlayer.tech',76931173n,'0x10908ada4cb486c8d506ba492aca1927e47a5a51e56f19e444f06f46c3acb574');
  const d=addresses;
  const queriedFor='0x0000000000000000000000000000000000000001';
  const runtime=await map(d,code);
  assert(Object.values(runtime).every(r=>r.bytes>0));
  const poolFromProvider=await read(d.aaveProvider,'getPool() view returns (address)');
  assert.equal(poolFromProvider.toLowerCase(),d.aavePool.toLowerCase());
  const reserveList=await read(d.aavePool,'getReservesList() view returns (address[])');
  const reserves=[];
  for(const address of reserveList) {
    const [symbol,decimals,receiptTokens,flags,caps,paused,virtualUnderlying]=await Promise.all([
      read(address,'symbol() view returns (string)'),read(address,'decimals() view returns (uint8)'),
      read(d.aaveData,'getReserveTokensAddresses(address) view returns (address,address,address)',[address]),
      read(d.aaveData,'getReserveConfigurationData(address) view returns (uint256,uint256,uint256,uint256,uint256,bool,bool,bool,bool,bool)',[address]),
      read(d.aaveData,'getReserveCaps(address) view returns (uint256,uint256)',[address]),
      read(d.aaveData,'getPaused(address) view returns (bool)',[address]),
      read(d.aavePool,'getVirtualUnderlyingBalance(address) view returns (uint128)',[address]),
    ]);
    const [aToken,,variableDebtToken]=receiptTokens;
    const [underlyingAtAToken,aTokenSupply,variableDebt]=await Promise.all([
      read(address,'balanceOf(address) view returns (uint256)',[aToken]),
      read(aToken,'totalSupply() view returns (uint256)'),read(variableDebtToken,'totalSupply() view returns (uint256)'),
    ]);
    const [borrowCap,supplyCap]=caps;
    reserves.push({address,symbol,decimals,aToken,variableDebtToken,underlyingAtAToken,virtualUnderlying,aTokenSupply,variableDebt,
      collateralEnabled:flags[5],borrowingEnabled:flags[6],active:flags[8],frozen:flags[9],paused,borrowCapWholeTokens:borrowCap,supplyCapWholeTokens:supplyCap});
  }
  const vaults=await map({sparkUSDC:d.sparkUSDC,sparkUSDT:d.sparkUSDT,aaveStataUSDC:d.aaveStataUSDC},async address=>{
    const asset=await read(address,'asset() view returns (address)');
    const [symbol,assetDecimals,shareDecimals,totalAssets,totalSupply,maxDeposit,maxWithdraw,maxRedeem,cashAtVault]=await Promise.all([
      read(address,'symbol() view returns (string)'),read(asset,'decimals() view returns (uint8)'),read(address,'decimals() view returns (uint8)'),
      read(address,'totalAssets() view returns (uint256)'),read(address,'totalSupply() view returns (uint256)'),
      read(address,'maxDeposit(address) view returns (uint256)',[queriedFor]),read(address,'maxWithdraw(address) view returns (uint256)',[queriedFor]),
      read(address,'maxRedeem(address) view returns (uint256)',[queriedFor]),read(asset,'balanceOf(address) view returns (uint256)',[address]),
    ]);
    const assetsIn=100n*10n**BigInt(assetDecimals);
    const previewShares=await read(address,'previewDeposit(uint256) view returns (uint256)',[assetsIn]);
    const previewAssets=await read(address,'previewRedeem(uint256) view returns (uint256)',[previewShares]);
    return {address,asset,symbol,assetDecimals,shareDecimals,totalAssets,totalSupply,queriedFor,maxDeposit,maxWithdraw,maxRedeem,cashAtVault,assetsIn,previewShares,previewAssets};
  });
  const v3=await Promise.all([
    read(d.uniV3Factory,'getPool(address,address,uint24) view returns (address)',[assets.WOKB,assets.USDC,500]),
    read(d.uniV3Router,'factory() view returns (address)'),read(d.uniV3Pool,'token0() view returns (address)'),
    read(d.uniV3Pool,'token1() view returns (address)'),read(d.uniV3Pool,'liquidity() view returns (uint128)'),
    read(d.uniV3Quoter,'quoteExactInputSingle((address,address,uint256,uint24,uint160)) returns (uint256,uint160,uint32,uint256)',[[assets.WOKB,assets.USDC,10n**18n,500,0n]]),
  ]);
  const feeds=await map({USDC:d.usdcFeed,OKB:d.okbFeed,sequencer:d.uptimeFeed},async address=>({
    address,description:await read(address,'description() view returns (string)'),
    decimals:await read(address,'decimals() view returns (uint8)'),round:await read(address,'latestRoundData() view returns (uint80,int256,uint256,uint256,uint80)'),
  }));
  const [pool,factory,token0,token1,liquidity,quote1WokbToUsdc]=v3;
  return {...pin,runtime,poolFromProvider,reserves,vaults,feeds,uniV3:{pool,factory,token0,token1,liquidity,quote1WokbToUsdc},
    v4StateViewPointsTo:await read(d.uniV4StateView,'poolManager() view returns (address)'),
    morphoOwner:await read(d.morpho,'owner() view returns (address)')};
}
async function runTest(){
  const {code,read,...pin}=await open(1952,'https://testrpc.xlayer.tech',47241372n,'0x2a87deeef4823bf2bc3eb248166ecacde8de15d104ee4deddc40b2f23642b54f');
  const mainnetCandidateAddresses=await map(addresses,code);
  const independentTestnetCandidates=await map({
    rangePilotV4Manager:'0x6df5DAE1e6216578e9eC63b239BFa6990AE6ed50',rangePilotStateView:'0x1cf2f6b229E313bAC1174F9e6c6a5Cd567F07F3E',
    circleTestUSDC:'0xDec90b78111Ba2fc6FC6d84d8B9ec159A2d4b9B3',communityQuaestorDex:'0x7cf23d5D7A49ca4113ed4b72e465b227E7978c12',
  },code);
  return {...pin,mainnetCandidateAddresses,independentTestnetCandidates,
    rangePilotStateViewPointsTo:await read(independentTestnetCandidates.rangePilotStateView.address,'poolManager() view returns (address)')};
}
const [mainnet,testnet]=await Promise.all([runMain(),runTest()]);
console.log(JSON.stringify({sources,mainnet,testnet},(_,v)=>typeof v==='bigint'?String(v):v,2));
