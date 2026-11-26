import { readFileSync } from 'node:fs';
import {
  BaseError,
  ContractFunctionRevertedError,
  createPublicClient,
  defineChain,
  encodeFunctionData,
  getAddress,
  http,
  zeroHash,
} from 'viem';
import {
  DemoRateModelAbi,
  IsolatedControllerAbi,
  MarketFactoryAbi,
  MarketPTokenAbi,
  PolicyRegistryAbi,
  SentinelAccountAbi,
  SentinelAccountFactoryAbi,
  TestnetOracleAbi,
  TestnetTokenAbi,
  xLayerTestnet,
} from '@peridot/chain-config';

const manifest = JSON.parse(
  readFileSync(new URL(import.meta.resolve('@peridot/chain-config/deployments/1952.json')), 'utf8'),
);
const chain = defineChain(xLayerTestnet);
const mainMarket = manifest.markets[0];
const account = getAddress('0xAD7c0077CbdDe5CbBcDD207F612B124f0c3776A0');
const operator = getAddress('0x2c7E78e47deBC84eFac28D336f98d54b4c1FCE88');
const owner = getAddress('0x8C1741a53d5FB97D74C1d105b0fbFbb4740d5D67');
if (
  manifest.chainId !== 1952 ||
  manifest.profile !== 'testnet' ||
  manifest.status !== 'deployed' ||
  !mainMarket
)
  throw Error('1952 manifest unavailable');
export const profile = Object.freeze({
  chainId: 1952,
  chain,
  account,
  operator,
  owner,
  factory: getAddress(manifest.contracts.SentinelAccountFactory),
  controller: getAddress(mainMarket.controller),
  debtMarket: getAddress(mainMarket.debtMarket),
  collateralMarket: getAddress(mainMarket.collateralMarket),
  debtAsset: getAddress(manifest.contracts.MockDebt),
  collateralAsset: getAddress(manifest.contracts.MockCollateral),
  deploymentCommit: manifest.commit,
  selector: encodeFunctionData({ abi: SentinelAccountAbi, functionName: 'autoRepay' }),
});
export const TOOL_NAMES = Object.freeze([
  'sentinel_get_portfolio',
  'sentinel_get_positions',
  'sentinel_get_markets',
  'sentinel_get_rates',
  'sentinel_get_policies',
  'sentinel_get_strategies',
  'sentinel_simulate_auto_repay',
  'sentinel_propose_auto_repay',
  'sentinel_execute_auto_repay',
  'sentinel_quote',
  'sentinel_simulate_operator_borrow',
  'sentinel_get_execution_receipt',
]);
export class ConnectError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}
export const fail = (code, message) => {
  throw new ConnectError(code, message);
};
export const jsonSafe = (data) =>
  JSON.parse(JSON.stringify(data, (_, v) => (typeof v === 'bigint' ? v.toString() : v)));
export const endpoints = Object.freeze([
  'https://testrpc.xlayer.tech',
  'https://xlayertestrpc.okx.com',
]);
export const clients = endpoints.map((url) =>
  createPublicClient({
    chain,
    transport: http(url, { timeout: 6500, retryCount: 0 }),
    cacheTime: 0,
  }),
);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let highWater = BigInt(manifest.deploymentBlock);
const same = (a, b) => getAddress(a) === getAddress(b);

export async function confirmedRead(
  action,
  { minimum = 0n, at, clientsForRead = clients, clock = Date.now } = {},
) {
  let reason = 'RPC_UNAVAILABLE';
  for (let attempt = 0; attempt < 3; attempt++) {
    const client = clientsForRead[attempt % clientsForRead.length];
    try {
      if ((await client.getChainId()) !== 1952)
        fail('WRONG_CHAIN', 'Expected X Layer testnet 1952');
      const tip = await client.getBlock({ blockTag: 'latest' });
      const age = BigInt(Math.floor(clock() / 1000)) - tip.timestamp;
      if (age > 120n || age < -15n || tip.number < 2n || tip.number - 2n < minimum)
        fail('STALE_RPC', 'RPC head is stale or behind the required confirmation depth');
      const number = at ?? tip.number - 2n;
      if (number > tip.number - 2n || (at === undefined && number < highWater))
        fail('STALE_RPC', 'Block is below the last verified head or awaiting confirmations');
      const block = await client.getBlock({ blockNumber: number });
      if (!block.hash || block.number !== number) fail('STALE_RPC', 'Block header missing');
      const read = (address, abi, functionName, args = []) =>
        client.readContract({ address, abi, functionName, args, blockNumber: number });
      const value = await action({ client, block, read });
      const canonical = await client.getBlock({ blockNumber: number });
      if (canonical.hash !== block.hash) fail('STALE_RPC', 'Block changed during the read');
      if (at === undefined && number > highWater) highWater = number;
      return {
        scope:
          'X Layer testnet / v1 isolated market / mock tokens and owner-set prices / development reference processor',
        chainId: 1952,
        deploymentCommit: manifest.commit,
        block: {
          number,
          hash: block.hash,
          timestamp: block.timestamp,
          confirmations: tip.number - number,
        },
        data: value,
      };
    } catch (e) {
      if (
        e instanceof ConnectError &&
        !['STALE_RPC', 'RPC_UNAVAILABLE', 'STALE_ORACLE'].includes(e.code)
      )
        throw e;
      reason = e instanceof ConnectError ? e.code : 'RPC_UNAVAILABLE';
      if (attempt < 2) await sleep(250 * (attempt + 1));
    }
  }
  fail(reason, 'No coherent confirmed result after three read attempts');
}

export async function verifyAccount({ read, client, block }) {
  const [
    registered,
    actualOwner,
    controller,
    known,
    loan,
    collateral,
    debtToken,
    collateralToken,
    code,
  ] = await Promise.all([
    read(profile.factory, SentinelAccountFactoryAbi, 'accountOf', [owner, profile.controller]),
    read(account, SentinelAccountAbi, 'owner'),
    read(account, SentinelAccountAbi, 'controller'),
    read(manifest.contracts.MarketFactory, MarketFactoryAbi, 'isMarket', [profile.controller]),
    read(account, SentinelAccountAbi, 'debtMarket'),
    read(account, SentinelAccountAbi, 'collateralMarket'),
    read(account, SentinelAccountAbi, 'debtAsset'),
    read(account, SentinelAccountAbi, 'collateralAsset'),
    client.getCode({ address: account, blockNumber: block.number }),
  ]);
  if (!code || code === '0x') fail('RPC_UNAVAILABLE', 'Missing configured account bytecode');
  if (
    !(
      known &&
      same(registered, account) &&
      same(actualOwner, owner) &&
      same(controller, profile.controller) &&
      same(loan, profile.debtMarket) &&
      same(collateral, profile.collateralMarket) &&
      same(debtToken, profile.debtAsset) &&
      same(collateralToken, profile.collateralAsset)
    )
  )
    fail('PROFILE_MISMATCH', 'On-chain account or market differs from the fixed manifest profile');
}
async function positions({ read }) {
  const assetPosition = async (kind, asset, book) => {
    const [idle, snapshot, symbol, decimals] = await Promise.all([
      read(asset, TestnetTokenAbi, 'balanceOf', [account]),
      read(book, MarketPTokenAbi, 'getAccountSnapshot', [account]),
      read(asset, TestnetTokenAbi, 'symbol'),
      read(asset, TestnetTokenAbi, 'decimals'),
    ]);
    if (snapshot[0] !== 0n)
      fail('POSITION_UNAVAILABLE', 'Lending book returned an invalid snapshot');
    return {
      kind,
      asset,
      book,
      symbol,
      decimals,
      idleRaw: idle,
      bookSharesRaw: snapshot[1],
      suppliedRaw: (snapshot[1] * snapshot[3]) / 10n ** 18n,
      borrowedStoredRaw: snapshot[2],
      exchangeRateStoredWad: snapshot[3],
    };
  };
  return Promise.all([
    assetPosition('collateral', profile.collateralAsset, profile.collateralMarket),
    assetPosition('debt', profile.debtAsset, profile.debtMarket),
  ]);
}
async function portfolio(ctx) {
  const assets = await positions(ctx);
  const amounts = await Promise.all(
    assets.map(async (x) => {
      const [price, fresh] = await ctx.read(
        manifest.contracts.TestnetOracle,
        TestnetOracleAbi,
        'price',
        [x.asset],
      );
      if (!fresh || !price) fail('STALE_ORACLE', 'Mock valuation quote is stale');
      const denominator = 10n ** BigInt(x.decimals);
      return {
        asset: x.asset,
        priceUsdWad: price,
        idleUsdWad: (x.idleRaw * price) / denominator,
        suppliedUsdWad: (x.suppliedRaw * price) / denominator,
        debtUsdWad: (x.borrowedStoredRaw * price + denominator - 1n) / denominator,
      };
    }),
  );
  const netUsdWad = amounts.reduce(
    (v, x) => v + x.idleUsdWad + x.suppliedUsdWad - x.debtUsdWad,
    0n,
  );
  return {
    account,
    owner,
    netUsdWad,
    amounts,
    accounting: 'Stored book balances at the pinned block; idle underlying shown separately.',
  };
}
async function markets({ read }) {
  return Promise.all(
    manifest.markets.map(async (m) => {
      const [active, limits, marketOwner, policyId, books, cash, totalBorrows] = await Promise.all([
        read(m.controller, IsolatedControllerAbi, 'active'),
        read(m.controller, IsolatedControllerAbi, 'limits'),
        read(m.controller, IsolatedControllerAbi, 'owner'),
        read(m.controller, IsolatedControllerAbi, 'policyId'),
        read(m.controller, IsolatedControllerAbi, 'getAllMarkets'),
        read(m.debtMarket, MarketPTokenAbi, 'getCash'),
        read(m.debtMarket, MarketPTokenAbi, 'totalBorrows'),
      ]);
      if (!same(books[0], m.collateralMarket) || !same(books[1], m.debtMarket))
        fail('PROFILE_MISMATCH', 'Market books differ from manifest');
      return {
        ...m,
        active,
        owner: marketOwner,
        policyId,
        debtCashRaw: cash,
        totalDebtRaw: totalBorrows,
        borrowLtvBps: limits[0],
        liquidationLtvBps: limits[1],
        collateralSupplyCapRaw: limits[2],
        debtSupplyCapRaw: limits[3],
        borrowCapRaw: limits[4],
        minDebtCashRaw: limits[5],
      };
    }),
  );
}
async function rates({ read }) {
  return Promise.all(
    manifest.markets
      .flatMap((m) => [m.collateralMarket, m.debtMarket])
      .map(async (book) => {
        const [model, borrow, supply] = await Promise.all(
          ['interestRateModel', 'borrowRatePerBlock', 'supplyRatePerBlock'].map((name) =>
            read(book, MarketPTokenAbi, name),
          ),
        );
        if (!same(model, manifest.contracts.DemoRateModel))
          fail('PROFILE_MISMATCH', 'Unrecognized rate model');
        const blocksPerYear = await read(model, DemoRateModelAbi, 'blocksPerYear');
        return {
          book,
          model,
          blocksPerYear,
          borrowRatePerBlockWad: borrow,
          supplyRatePerBlockWad: supply,
          simpleBorrowAprWad: borrow * blocksPerYear,
          simpleSupplyAprWad: supply * blocksPerYear,
        };
      }),
  );
}
async function policies({ read }) {
  const market = await read(profile.controller, IsolatedControllerAbi, 'policyId');
  const individual = await read(account, SentinelAccountAbi, 'policyId');
  return Promise.all(
    [market, individual].map(async (id, i) => ({
      layer: i ? 'account' : 'market',
      id,
      registry: manifest.contracts.PolicyRegistry,
      entry:
        id === zeroHash
          ? null
          : await read(manifest.contracts.PolicyRegistry, PolicyRegistryAbi, 'getPolicy', [id]),
    })),
  );
}
export async function strategy({ read, block }) {
  const [trigger, grant] = await Promise.all([
    read(account, SentinelAccountAbi, 'autoRepayTriggerBps'),
    read(account, SentinelAccountAbi, 'operators', [operator]),
  ]);
  return {
    name: 'v1-auto-repay',
    account,
    operator,
    triggerBps: trigger,
    opMask: grant[0],
    remainingDebtRaw: grant[1],
    expiry: grant[2],
    repayOnly: grant[0] === 8,
    grantLive: grant[0] === 8 && grant[1] > 0n && grant[2] > block.timestamp,
  };
}
export async function simulate(ctx) {
  const { client, block } = ctx;
  const grant = await strategy(ctx);
  if (!grant.grantLive) return { eligible: false, reason: 'REPAY_ONLY_GRANT_UNAVAILABLE', grant };
  if (!grant.triggerBps) return { eligible: false, reason: 'TRIGGER_DISABLED', grant };
  const quotes = await Promise.all(
    [profile.collateralAsset, profile.debtAsset].map((asset) =>
      ctx.read(manifest.contracts.TestnetOracle, TestnetOracleAbi, 'price', [asset]),
    ),
  );
  if (quotes.some(([price, fresh]) => !price || !fresh))
    fail('STALE_ORACLE', 'A testnet quote is stale');
  try {
    const { result } = await client.simulateContract({
      address: account,
      abi: SentinelAccountAbi,
      functionName: 'autoRepay',
      account: operator,
      blockNumber: block.number,
    });
    if (result <= 0n || result > grant.remainingDebtRaw)
      fail('INVALID_SIMULATION', 'Invalid repayment amount');
    return { eligible: true, amountRaw: result, asset: profile.debtAsset, grant };
  } catch (e) {
    const revert =
      e instanceof BaseError ? e.walk((err) => err instanceof ContractFunctionRevertedError) : null;
    if (revert instanceof ContractFunctionRevertedError)
      return { eligible: false, reason: revert.data?.errorName ?? 'CONTRACT_REVERT', grant };
    throw e;
  }
}
async function simulateOperatorBorrow({ client, block }) {
  const amountRaw = 1_000_000n;
  try {
    await client.simulateContract({
      address: account,
      abi: SentinelAccountAbi,
      functionName: 'borrow',
      args: [amountRaw],
      account: operator,
      blockNumber: block.number,
    });
    return {
      method: 'eth_call',
      operation: 'borrow',
      amountRaw,
      account,
      operator,
      rejected: false,
    };
  } catch (e) {
    const revert =
      e instanceof BaseError ? e.walk((err) => err instanceof ContractFunctionRevertedError) : null;
    if (!(revert instanceof ContractFunctionRevertedError)) throw e;
    return {
      method: 'eth_call',
      operation: 'borrow',
      amountRaw,
      account,
      operator,
      rejected: true,
      error: revert.data?.errorName ?? 'CONTRACT_REVERT',
      args: revert.data?.args ?? [],
      revertData: revert.raw ?? null,
    };
  }
}
export async function readTool(tool) {
  const handlers = {
    sentinel_get_portfolio: portfolio,
    sentinel_get_positions: positions,
    sentinel_get_markets: markets,
    sentinel_get_rates: rates,
    sentinel_simulate_operator_borrow: simulateOperatorBorrow,
    sentinel_get_policies: policies,
    sentinel_get_strategies: strategy,
    sentinel_simulate_auto_repay: simulate,
  };
  if (!Object.hasOwn(handlers, tool)) fail('UNKNOWN_TOOL', 'Unknown read tool');
  return confirmedRead(async (ctx) => {
    await verifyAccount(ctx);
    return handlers[tool](ctx);
  });
}

// A structural MCP client interface keeps read-only SDK consumers independent of the transport package.
export async function callConnectTool(client, name, args = {}) {
  if (!TOOL_NAMES.includes(name)) fail('UNKNOWN_TOOL', 'Unknown Sentinel Connect tool');
  const response = await client.callTool({ name, arguments: args });
  if (!response || typeof response !== 'object')
    fail('BAD_MCP_RESULT', 'Expected a structured MCP response');
  if (response.isError) {
    const error = response.structuredContent?.error;
    fail(error?.code ?? 'MCP_ERROR', error?.message ?? 'Sentinel Connect tool call failed');
  }
  if (!response.structuredContent || !Object.hasOwn(response.structuredContent, 'result')) {
    fail('BAD_MCP_RESULT', 'Expected a structured Sentinel Connect result');
  }
  return response.structuredContent.result;
}
