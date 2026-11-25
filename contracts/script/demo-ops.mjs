// All writes use the deployment journal. All recorded state is pinned to a mined receipt.
import assert from 'node:assert/strict';
import { getAddress } from 'viem';

const wad = 10n ** 18n;
const usd = 10n ** 6n;

export async function preparePosition(env) {
  const {call,event,readAt,rpc,sender,operator,sentinelFactory,market,collateral,accountPolicy} = env;
  const made = await call('create-demo-account','SentinelAccountFactory',sentinelFactory,'createAccount',[market.controller,accountPolicy]);
  const {account} = event(made,'SentinelAccountFactory','AccountCreated',sentinelFactory);
  await call('mint-demo-collateral','TestnetToken',collateral,'mint',[account,100n*wad]);
  await call('enter-collateral','SentinelAccount',account,'enterCollateral');
  await call('supply-collateral','SentinelAccount',account,'supply',[100n*wad]);
  const borrowed = await call('borrow-demo-dollars','SentinelAccount',account,'borrow',[80n*usd]);
  const at = borrowed.blockNumber;
  const [ltv, debt, borrowedFunds, collateralShares] = await Promise.all([
    readAt('IsolatedController',market.controller,'currentLtvBps',[account],at),
    readAt('MarketPToken',market.debtMarket,'borrowBalanceStored',[account],at),
    readAt('TestnetToken',env.debt,'balanceOf',[account],at),
    readAt('MarketPToken',market.collateralMarket,'balanceOf',[account],at),
  ]);
  assert.equal(debt,80n*usd);
  assert.equal(borrowedFunds,80n*usd);
  assert.equal(collateralShares,100n*wad);
  assert.equal(ltv,4000n);
  await call('configure-trigger','SentinelAccount',account,'setAutoRepayTrigger',[4500]);
  const {timestamp} = await rpc.getBlock({blockNumber:at});
  const expiry = timestamp + 86400n;
  await call('grant-repay-only','SentinelAccount',account,'setOperator',[operator,8,20n*usd,expiry]);
  return {account,borrowed,snapshot:{account,owner:sender,operator,borrowBlock:at,ltvBps:ltv,debt,borrowedFunds,
    collateralShares,triggerBps:4500,grantMask:8,grantRawDebtUnits:20n*usd,expiry}};
}

async function positionAt({readAt}, market, borrower, block) {
  const {controller,collateralMarket,debtMarket} = market;
  const [shares,debt,cash,supply,borrowTotal,ltvBps] = await Promise.all([
    readAt('MarketPToken',collateralMarket,'balanceOf',[borrower],block),
    readAt('MarketPToken',debtMarket,'borrowBalanceStored',[borrower],block),
    readAt('MarketPToken',debtMarket,'getCash',[],block),
    readAt('MarketPToken',debtMarket,'totalSupply',[],block),
    readAt('MarketPToken',debtMarket,'totalBorrows',[],block),
    readAt('IsolatedController',controller,'currentLtvBps',[borrower],block),
  ]);
  return {shares,debt,cash,supply,borrowTotal,ltvBps};
}

async function moveMockPrice(env, market, account, label, price) {
  const {call,readAt,oracle,collateral} = env;
  const receipt = await call(label,'TestnetOracle',oracle,'setPrice',[collateral,price]);
  const at = receipt.blockNumber;
  const before = await readAt('TestnetOracle',oracle,'quotes',[collateral],at-1n);
  const after = await readAt('TestnetOracle',oracle,'quotes',[collateral],at);
  assert.equal(after[0],price);
  const position = await positionAt(env,market,account,at);
  return {label:'TestnetOracle manual price simulation',market,account,receipt:receipt.transactionHash,block:at,
    oldPriceWad:before[0],newPriceWad:after[0],position};
}

async function secondMarket(env) {
  const {call,event,readAt,sender,marketFactory,sentinelFactory,collateral,debt,marketPolicy,accountPolicy} = env;
  const created = await call('ops-create-independent-market','MarketFactory',marketFactory,'createMarket',
    [marketPolicy,7500,8500,500n*wad,1000n*usd,900n*usd,10n*usd]);
  const {controller,collateralMarket,debtMarket} = event(created,'MarketFactory','MarketCreated',marketFactory);
  const market = {controller,collateralMarket,debtMarket};
  for (const key of Object.keys(market)) assert.notEqual(market[key],env.market[key]);
  await call('ops-mint-independent-liquidity','TestnetToken',debt,'mint',[sender,200n*usd]);
  await call('ops-approve-independent-seed','TestnetToken',debt,'approve',[debtMarket,200n*usd]);
  await call('ops-supply-independent-seed','MarketPToken',debtMarket,'mint',[200n*usd]);
  await call('ops-activate-independent-market','IsolatedController',controller,'activate');
  const createdAccount = await call('ops-create-independent-account','SentinelAccountFactory',sentinelFactory,'createAccount',[controller,accountPolicy]);
  const {account} = event(createdAccount,'SentinelAccountFactory','AccountCreated',sentinelFactory);
  await call('ops-fund-independent-account','TestnetToken',collateral,'mint',[account,100n*wad]);
  await call('ops-enter-independent-collateral','SentinelAccount',account,'enterCollateral');
  await call('ops-supply-independent-collateral','SentinelAccount',account,'supply',[100n*wad]);
  const borrowed = await call('ops-borrow-independent-dollars','SentinelAccount',account,'borrow',[30n*usd]);
  const b = borrowed.blockNumber;
  const [marketState,firstBorrowerShares,firstBorrowerDebt,secondBorrowerShares,secondBorrowerDebt] = await Promise.all([
    positionAt(env,market,account,b),
    readAt('MarketPToken',collateralMarket,'balanceOf',[env.account],b),
    readAt('MarketPToken',debtMarket,'borrowBalanceStored',[env.account],b),
    readAt('MarketPToken',env.market.collateralMarket,'balanceOf',[account],b),
    readAt('MarketPToken',env.market.debtMarket,'borrowBalanceStored',[account],b),
  ]);
  assert.equal(marketState.debt,30n*usd);
  assert.equal(marketState.cash,170n*usd);
  assert.equal(marketState.shares,100n*wad);
  assert.deepEqual([firstBorrowerShares,firstBorrowerDebt,secondBorrowerShares,secondBorrowerDebt],[0n,0n,0n,0n]);
  return {market,account,block:b,atCreation:marketState,
    firstAccountInSecondMarket:{shares:firstBorrowerShares,debt:firstBorrowerDebt},
    secondAccountInFirstMarket:{shares:secondBorrowerShares,debt:secondBorrowerDebt}};
}

async function liquidate(env, independent) {
  const {call,event,readAt,anchor,account,market,debt,liquidator} = env;
  // Persist the observation before pricing so resume computes the same amounts even after a keeper repayment.
  const b = await anchor('liquidation-valuation');
  const position = await positionAt(env,market,account,b);
  const exchangeRate = await readAt('MarketPToken',market.collateralMarket,'exchangeRateStored',[],b);
  const underlying = position.shares * exchangeRate / wad;
  assert.ok(position.debt >= 4n && underlying > 0n,'Liquidation demo needs a funded open position');
  const debtPrice = (await readAt('TestnetOracle',env.oracle,'price',[debt],b))[0];
  const mockPrice = position.debt * debtPrice * wad * 10000n / (usd * underlying * 9200n);
  const shock = await moveMockPrice(env,market,account,'ops-liquidation-mock-price',mockPrice);
  assert.ok(shock.position.ltvBps > 8500n,'Borrower must cross the liquidation threshold');
  const repayAmount = position.debt / 4n;
  await call('ops-mint-liquidator-funds','TestnetToken',debt,'mint',[liquidator,repayAmount]);
  await call('ops-approve-liquidation','TestnetToken',debt,'approve',[market.debtMarket,repayAmount],liquidator);
  const receipt = await call('ops-liquidate-borrow','MarketPToken',market.debtMarket,'liquidateBorrow',
    [account,repayAmount,market.collateralMarket],liquidator);
  const result = event(receipt,'MarketPToken','LiquidateBorrow',market.debtMarket);
  assert.equal(getAddress(result.liquidator),liquidator);
  assert.equal(getAddress(result.borrower),account);
  assert.equal(getAddress(result.pTokenCollateral),market.collateralMarket);
  assert.equal(result.repayAmount,repayAmount);
  async function state(block) {
    const [borrower,other,liquidatorFunds,liquidatorShares,allowance] = await Promise.all([
      positionAt(env,market,account,block),positionAt(env,independent.market,independent.account,block),
      readAt('TestnetToken',debt,'balanceOf',[liquidator],block),
      readAt('MarketPToken',market.collateralMarket,'balanceOf',[liquidator],block),
      readAt('TestnetToken',debt,'allowance',[liquidator,market.debtMarket],block),
    ]);
    return {borrower,independent:other,liquidatorFunds,liquidatorShares,allowance};
  }
  const [before,after] = await Promise.all([state(receipt.blockNumber-1n),state(receipt.blockNumber)]);
  assert.equal(before.allowance,repayAmount);
  assert.equal(after.allowance,0n);
  assert.equal(before.liquidatorFunds-after.liquidatorFunds,repayAmount);
  assert.equal(after.borrower.cash-before.borrower.cash,repayAmount);
  assert.ok(after.borrower.debt < before.borrower.debt);
  assert.equal(before.borrower.shares-after.borrower.shares,result.seizeTokens);
  assert.ok(after.liquidatorShares > before.liquidatorShares);
  // Both books use the shared price feed. Compare both states at the SAME price across the liquidation itself.
  assert.deepEqual(before.independent,after.independent);
  return {receipt:receipt.transactionHash,block:receipt.blockNumber,liquidator,borrower:account,market,repayAmount,
    seizeTokens:result.seizeTokens,liquidatorSeizeTokens:after.liquidatorShares-before.liquidatorShares,
    protocolSeizeTokens:result.seizeTokens-(after.liquidatorShares-before.liquidatorShares),shock,before,after};
}

export async function runDemoOps(env,operation) {
  const prepared = await preparePosition(env);
  const result = {fresh:prepared.snapshot};
  if (operation === 'fresh') return result;
  if (operation === 'price' || operation === 'all') {
    result.price = await moveMockPrice(env,env.market,prepared.account,'move-mock-price',16n*wad/10n);
  }
  if (operation === 'price') return result;
  const context = {...env,account:prepared.account};
  result.isolation = await secondMarket(context);
  if (operation === 'liquidate' || operation === 'all') result.liquidation = await liquidate(context,result.isolation);
  return result;
}
