import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { clients, profile } from '../../packages/sentinel-sdk/index.mjs';
import { verifySettlement } from './execution.mjs';

const record = JSON.parse(
  await readFile(
    new URL('../../evidence/session5-mcp/flagship-1952.json', import.meta.url),
    'utf8',
  ),
);
const steps = record.steps;
assert.deepEqual(Object.keys(steps), ['1', '2', '3', '4', '5', '6', '7']);
assert.equal(steps[1].account.data.account, profile.account);
assert.equal(steps[2].authorization.data.opMask, 8);
assert(['quoted', 'blocked'].includes(steps[3].status));
assert.equal(steps[3].chainId, 196);
if (steps[3].status === 'blocked') assert.equal(steps[3].quote, null);
else assert(BigInt(steps[3].quote.amountOut) > 0n);
assert.equal(steps[4].simulation.data.eligible, true);
assert.equal(steps[5].state, 'confirmed');
assert.equal(steps[6].data.method, 'eth_call');
assert.equal(steps[6].data.rejected, true);
assert.equal(steps[6].data.error, 'OperatorNotAuthorized');
assert.deepEqual(steps[6].data.args, [profile.operator, 2]);
assert(BigInt(steps[6].block.number) >= BigInt(steps[5].receipt.blockNumber));
assert(BigInt(steps[7].updatedAuthorization.block.number) >= BigInt(steps[5].receipt.blockNumber));
assert.equal(steps[5].receipt.hash, steps[7].transaction.receipt.hash);
const actual = BigInt(steps[5].actual.amount);
assert(actual > 0n);
assert.equal(
  BigInt(steps[2].authorization.data.remainingDebtRaw) - actual,
  BigInt(steps[7].updatedAuthorization.data.remainingDebtRaw),
);
assert.equal(
  BigInt(steps[5].before.walletDebtAssetRaw) - actual,
  BigInt(steps[5].after.walletDebtAssetRaw),
);
assert.equal(
  BigInt(steps[5].before.remainingGrantRaw) - actual,
  BigInt(steps[5].after.remainingGrantRaw),
);
assert(BigInt(steps[5].after.debtStoredRaw) < BigInt(steps[5].before.debtStoredRaw));
assert(BigInt(steps[5].actual.ltvAfterBps) < BigInt(steps[5].actual.ltvBeforeBps));
const receipt = await clients[0].getTransactionReceipt({ hash: steps[5].receipt.hash });
const onchain = await verifySettlement(
  steps[4].proposed.proposal.id,
  receipt.transactionHash,
  steps[5].receipt.nonce,
  receipt,
);
for (const field of ['receipt', 'actual', 'repayBookEvent', 'before', 'after'])
  assert.deepEqual(onchain[field], steps[5][field]);
console.log(
  'Public recording and canonical settlement verified:',
  receipt.transactionHash,
  'repay raw',
  String(actual),
  'quote',
  steps[3].status,
);
