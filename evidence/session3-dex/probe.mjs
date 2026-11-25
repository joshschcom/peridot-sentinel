// Replay from the workspace root: node evidence/session3-dex/probe.mjs
// Public JSON-RPC reads only. Quoter calls simulate against the pinned block.
import assert from 'node:assert/strict';
import { createPublicClient, formatUnits, getAddress, http, keccak256, parseAbiItem, zeroAddress } from 'viem';

const sources = {
  uniswap: 'https://developers.uniswap.org/docs/protocols/v3/deployments/v3-xlayer-deployments',
  quickswap: 'https://docs.quickswap.exchange/overview/contracts-and-addresses',
  circle: 'https://www.circle.com/blog/now-available-native-usdc-cctp-on-x-layer',
  circleNetworks: 'https://developers.circle.com/stablecoins/usdc-contract-addresses',
  tokens: 'https://github.com/okx/xlayer-tokenlist/blob/443b0e3057ccf494a7f82f3dda095d1de9580cad/xlayer.tokenlist.json',
  paxos: 'https://docs.paxos.com/guides/stablecoin/usdg/mainnet',
  quaestor: 'https://github.com/N-45div/Quaestor/blob/7dc08d144df27f2b3d4208dda483c4c5cfa342ef/deployments/xlayerTestnet.json',
  quaestorCode: 'https://github.com/N-45div/Quaestor/blob/7dc08d144df27f2b3d4208dda483c4c5cfa342ef/contracts/QuaestorDEX.sol',
  rangePilot: 'https://github.com/RangePilot/RangePilot/blob/553e940edaf1f0afbe6485b50d63fc326fa66091/packages/contracts/deployments/xlayer-testnet.json',
  rangePilotPair: 'https://github.com/RangePilot/RangePilot/blob/553e940edaf1f0afbe6485b50d63fc326fa66091/packages/contracts/broadcast/CreatePoolAndBindVault.s.sol/1952/run-latest.json',
};
const main = {
  chainId: 196, url: 'https://rpc.xlayer.tech', number: 76847934n,
  hash: '0xc7b2a1993b2522b89d2fa52d7fb3ddc0a36d352472f6af3d2f685dd9722bb28a',
};
const test = {
  chainId: 1952, url: 'https://testrpc.xlayer.tech', number: 47158133n,
  hash: '0x612abc213803019d79ed94ada3321c3d31a56426447191ed506af4e4e109a40f',
};
const venues = {
  uniFactory: '0x4B2ab38DBF28D31D467aA8993f6c2585981D6804',
  uniRouter: '0x4f0c28f5926afda16bf2506d5d9e57ea190f9bca',
  uniQuoter: '0xd1b797d92d87b688193a2b976efc8d577d204343',
  quickFactory: '0xd2480162Aa7F02Ead7BF4C127465446150D58452',
  quickRouter: '0x4B9f4d2435Ef65559567e5DbFC1BbB37abC43B57',
  quickQuoter: '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270',
  quickPoolDeployer: '0x56c2162254b0E4417288786eE402c2B41d4e181e',
};
const tokens = {
  WOKB: '0xe538905cf8410324e03A5A23C1c177a474D59b2b',
  USDC: '0xB6CEceAB302E2E4948951eE7843FC24E92933061',
  oldBridgedUSDC: '0x74b7F16337b8972027F6196A17a631aC6dE26d22',
  USDT0: '0x779Ded0c9e1022225f8E0630b35a9b54bE713736',
  USDG: '0x4ae46a509F6b1D9056937BA4500cb143933D2dc8',
};
const testAddresses = {
  USDC: '0xDec90b78111Ba2fc6FC6d84d8B9ec159A2d4b9B3',
  quaestorDex: '0x7cf23d5D7A49ca4113ed4b72e465b227E7978c12',
  qUSD: '0x99D7fcf0153b1CB171F0de432D8aC159Abc63b24',
  rangePilotManager: '0x6df5DAE1e6216578e9eC63b239BFa6990AE6ed50',
  rangePilotView: '0x1cf2f6b229E313bAC1174F9e6c6a5Cd567F07F3E',
  rangePilotTokenA: '0x9e29b3aada05bf2d2c827af80bd28dc0b9b4fb0c',
  rangePilotTokenB: '0xcb8bf24c6ce16ad21d707c9505421a17f2bec79d',
};
const rangePoolId = '0xb66f3b888223eafafbad9dcea1af3c57eae6cfebf5629f2c81a9902d644c251e';
const fees = [100, 500, 3000, 10000];

async function mapRecord(record, fn) {
  return Object.fromEntries(await Promise.all(Object.entries(record).map(async ([k, v]) => [k, await fn(v, k)])));
}
function sameAddress(a, b) { assert.equal(a.toLowerCase(), b.toLowerCase()); }

async function openPin(network) {
  const client = createPublicClient({ transport: http(network.url, { batch: { batchSize: 8, wait: 15 } }) });
  const [chainId, block] = await Promise.all([client.getChainId(), client.getBlock({ blockNumber: network.number })]);
  assert.equal(chainId, network.chainId);
  assert.equal(block.hash, network.hash);
  const read = (address, signature, args = []) => {
    const item = parseAbiItem('function ' + signature);
    return client.readContract({ address: getAddress(address.toLowerCase()), abi: [item], functionName: item.name,
      args, blockNumber: network.number });
  };
  const code = async address => {
    const bytes = (await client.getCode({ address, blockNumber: network.number })) ?? '0x';
    return { address: getAddress(address.toLowerCase()), bytes: (bytes.length - 2) / 2,
      runtimeHash: bytes === '0x' ? null : keccak256(bytes) };
  };
  return { metadata: { ...network, timestamp: block.timestamp, UTC: new Date(Number(block.timestamp) * 1000).toISOString() }, read, code };
}

async function tokenInfo(rpc, address) {
  const [runtime, symbol, decimals] = await Promise.all([
    rpc.code(address), rpc.read(address, 'symbol() view returns (string)'), rpc.read(address, 'decimals() view returns (uint8)'),
  ]);
  return { ...runtime, symbol, decimals };
}
async function selectedPool(rpc, address, factory, asset, stateSig) {
  const [runtime, actualFactory, token0, token1, inRangeLiquidity, state] = await Promise.all([
    rpc.code(address), rpc.read(address, 'factory() view returns (address)'), rpc.read(address, 'token0() view returns (address)'),
    rpc.read(address, 'token1() view returns (address)'), rpc.read(address, 'liquidity() view returns (uint128)'), rpc.read(address, stateSig),
  ]);
  sameAddress(actualFactory, factory);
  assert.deepEqual([token0, token1].map(x => x.toLowerCase()), [tokens.WOKB, asset].map(x => x.toLowerCase()).sort());
  const balancesRaw = await Promise.all([token0, token1].map(t => rpc.read(t, 'balanceOf(address) view returns (uint256)', [address])));
  return { ...runtime, factory: actualFactory, token0, token1, balancesRaw, inRangeLiquidity, state };
}

async function mainnet() {
  const rpc = await openPin(main);
  const [runtime, token, bindings] = await Promise.all([
    mapRecord(venues, rpc.code), mapRecord(tokens, address => tokenInfo(rpc, address)),
    mapRecord({ uniRouter: venues.uniRouter, uniQuoter: venues.uniQuoter, quickRouter: venues.quickRouter, quickQuoter: venues.quickQuoter },
      async (address, name) => {
        const factory = await rpc.read(address, 'factory() view returns (address)');
        sameAddress(factory, name.startsWith('uni') ? venues.uniFactory : venues.quickFactory);
        if (name.startsWith('uni')) {
          const wrappedNative = await rpc.read(address, 'WETH9() view returns (address)');
          sameAddress(wrappedNative, tokens.WOKB);
          return { factory, wrappedNative };
        }
        return { factory };
      }),
  ]);
  assert.equal(token.WOKB.decimals, 18);
  assert.equal(token.USDC.decimals, 6);
  const matrix = await mapRecord(Object.fromEntries(Object.entries(tokens).slice(1)), async asset => ({
    uniswapByFeePips: Object.fromEntries(await Promise.all(fees.map(async fee => [fee, await rpc.read(venues.uniFactory,
      'getPool(address,address,uint24) view returns (address)', [tokens.WOKB, asset, fee])]))),
    quickswap: await rpc.read(venues.quickFactory, 'poolByPair(address,address) view returns (address)', [tokens.WOKB, asset]),
  }));
  const poolAddress = matrix.USDC.uniswapByFeePips[500];
  sameAddress(poolAddress, '0x9f73888Fb725A3409548BC8d2e42365AC063E148');
  sameAddress(matrix.USDC.quickswap, zeroAddress);
  const pool = await selectedPool(rpc, poolAddress, venues.uniFactory, tokens.USDC,
    'slot0() view returns (uint160 sqrtPriceX96,int24 tick,uint16 observationIndex,uint16 observationCardinality,uint16 observationCardinalityNext,uint8 feeProtocol,bool unlocked)');
  pool.feePips = await rpc.read(poolAddress, 'fee() view returns (uint24)');
  assert.equal(pool.feePips, 500);
  pool.stateFields = ['sqrtPriceX96','tick','observationIndex','observationCardinality','observationCardinalityNext','feeProtocol','unlocked'];
  const quotes = {};
  for (const [type, tokenIn, tokenOut, sizes] of [
    ['exactInput', 'WOKB', 'USDC', [1n, 10n, 100n]], ['exactInput', 'USDC', 'WOKB', [100n, 1000n, 10000n]],
    ['exactOutput', 'WOKB', 'USDC', [100n, 1000n, 10000n]],
  ]) {
    const isInput = type === 'exactInput';
    const fixed = isInput ? tokenIn : tokenOut;
    const result = isInput ? tokenOut : tokenIn;
    const sig = (isInput ? 'quoteExactInputSingle' : 'quoteExactOutputSingle') +
      '((address,address,uint256,uint24,uint160)) returns (uint256 amount,uint160 sqrtPriceX96After,uint32 initializedTicksCrossed,uint256 gasEstimate)';
    quotes[type + '_' + tokenIn + '_' + tokenOut] = await Promise.all(sizes.map(async size => {
      const amount = size * 10n ** BigInt(token[fixed].decimals);
      const [quotedAmount, sqrtPriceX96After, initializedTicksCrossed, quoterGasEstimate] =
        await rpc.read(venues.uniQuoter, sig, [[tokens[tokenIn], tokens[tokenOut], amount, 500, 0n]]);
      assert(quotedAmount > 0n && sqrtPriceX96After > 4295128740n && sqrtPriceX96After < 1461446703485210103287273052203988822378723970341n);
      return { fixed, size, fixedAmountRaw: amount, result, amountRaw: quotedAmount, amount: formatUnits(quotedAmount, token[result].decimals),
        sqrtPriceX96After, initializedTicksCrossed, quoterGasEstimate };
    }));
  }
  const quick = await selectedPool(rpc, matrix.USDT0.quickswap, venues.quickFactory, tokens.USDT0,
    'globalState() view returns (uint160,int24,uint16,uint16,uint8,uint8,bool)');
  quick.stateFields = ['sqrtPriceX96','tick','fee','timepointIndex','communityFeeToken0','communityFeeToken1','unlocked'];
  const qSig = 'quoteExactInputSingle(address,address,uint256,uint160) returns (uint256)';
  quick.quotes = await Promise.all([['WOKB','USDT0',1n], ['USDT0','WOKB',100n]].map(async ([input, output, size]) => {
    const amountIn = size * 10n ** BigInt(token[input].decimals);
    try {
      const amountOut = await rpc.read(venues.quickQuoter, qSig, [tokens[input], tokens[output], amountIn, 0n]);
      return { input, output, amountIn, amountOut };
    } catch (e) {
      const inner = e.walk?.(cause => cause.name === 'ContractFunctionRevertedError');
      if (!inner) throw e;
      return { input, output, amountIn, revert: inner.reason ?? inner.shortMessage };
    }
  }));
  return { ...rpc.metadata, runtime, bindings, tokens: token, directWokbFactoryResults: matrix, nativeUsdcUniswapPool: pool,
    nativeUsdcUniswapQuoterV2: quotes, quickswapUsdt0Pool: quick };
}

async function testnet() {
  const rpc = await openPin(test);
  const [mainnetAddressChecks, projectAddresses, token, rangePilotLiquidity, linkedManager] = await Promise.all([
    mapRecord(venues, rpc.code), mapRecord(testAddresses, rpc.code),
    mapRecord({ USDC: testAddresses.USDC, qUSD: testAddresses.qUSD,
      rangePilotTokenA: testAddresses.rangePilotTokenA, rangePilotTokenB: testAddresses.rangePilotTokenB }, a => tokenInfo(rpc, a)),
    rpc.read(testAddresses.rangePilotView, 'getLiquidity(bytes32) view returns (uint128)', [rangePoolId]),
    rpc.read(testAddresses.rangePilotView, 'poolManager() view returns (address)'),
  ]);
  sameAddress(linkedManager, testAddresses.rangePilotManager);
  const dex = testAddresses.quaestorDex;
  const [qa, cb, feeNum, feeDen] = await Promise.all([
    ...[testAddresses.qUSD, testAddresses.USDC].map(t => rpc.read(dex, 'pools(address) view returns (uint256,uint256,uint256)', [t])),
    rpc.read(dex, 'FEE_NUM() view returns (uint256)'), rpc.read(dex, 'FEE_DEN() view returns (uint256)'),
  ]);
  const sample = await Promise.all([['testOKB','qUSD',10n ** 16n], ['testOKB','qUSD',10n ** 18n],
    ['qUSD','testOKB',10n ** BigInt(token.qUSD.decimals)], ['qUSD','testOKB',100n * 10n ** BigInt(token.qUSD.decimals)]]
    .map(async ([input, output, amountIn]) => {
      const isNative = input === 'testOKB';
      const [reserveIn,reserveOut] = isNative ? qa : [qa[1],qa[0]];
      const expected = amountIn * feeNum * reserveOut / (reserveIn * feeDen + amountIn * feeNum);
      const fn = isNative ? 'getNativeToTokenOut' : 'getTokenToNativeOut';
      const amountOut = await rpc.read(dex, fn + '(address,uint256) view returns (uint256)', [testAddresses.qUSD,amountIn]);
      assert.equal(amountOut, expected);
      return { input, output, amountIn, amountOut, formattedOut: formatUnits(amountOut, isNative ? token.qUSD.decimals : 18) };
    }));
  return { ...rpc.metadata, mainnetAddressChecks, projectAddresses, tokens: token,
    quaestor: { reservesTuple: ['reserveNative','reserveToken','totalShares'], qUSD: qa, circleUSDC: cb, feeNum, feeDen, sample },
    rangePilot: { poolId: rangePoolId, linkedManager, rangePilotLiquidity, pairFromProjectBroadcast: [testAddresses.rangePilotTokenA, testAddresses.rangePilotTokenB] } };
}
const [chain196, chain1952] = await Promise.all([mainnet(), testnet()]);
console.log(JSON.stringify({ sources, chain196, chain1952 }, (_, v) => typeof v === 'bigint' ? v.toString() : v, 2));
