import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { confirmedRead, ConnectError, TOOL_NAMES } from '../../../packages/sentinel-sdk/index.mjs';
import { catalog, handle } from '../server.mjs';
import { Journal } from '../journal.mjs';

test('catalog has twelve tools and one restricted write', async () => {
  assert.equal(catalog.length, 12);
  assert.equal(catalog.filter((t) => t.annotations.destructiveHint).length, 1);
  for (const tool of catalog) assert.equal(tool.inputSchema.additionalProperties, false);
  const wrong = await handle('sentinel_execute_auto_repay', {
    proposalId: '0x' + 'a'.repeat(64),
    data: '0x',
  });
  assert.equal(wrong.structuredContent.error.code, 'INVALID_ARGUMENT');
  assert.equal(
    (await handle('sentinel_withdraw', {})).structuredContent.error.code,
    'UNKNOWN_TOOL',
  );
  for (const name of TOOL_NAMES.slice(0, 8))
    assert.equal(
      (await handle(name, { chainId: 196 })).structuredContent.error.code,
      'INVALID_ARGUMENT',
    );
  delete process.env.SENTINEL_ENABLE_EXECUTE;
  assert.equal(
    (await handle(TOOL_NAMES[8], { proposalId: '0x' + 'a'.repeat(64) })).structuredContent.error
      .code,
    'EXECUTION_DISABLED',
  );
});

const clock = () => 1_000_000;
const head = { number: 50_000_005n, timestamp: 1000n, hash: '0xhead' };
function rpcStub(headers) {
  return { getChainId: async () => 1952, getBlock: async () => headers.shift() };
}
test('read retries a changed hash then returns a single confirmed snapshot', async () => {
  const pinned = { ...head, number: head.number - 2n, hash: '0xaa' };
  const first = rpcStub([head, pinned, { ...pinned, hash: '0xbb' }]);
  const second = rpcStub([head, pinned, pinned]);
  const got = await confirmedRead(async ({ block }) => block.hash, {
    clientsForRead: [first, second],
    clock,
  });
  assert.equal(got.data, '0xaa');
  assert.equal(got.block.confirmations, 2n);
});
test('wrong chain aborts and persistent stale state exhausts exactly three reads', async () => {
  let attempts = 0;
  const wrong = { getChainId: async () => 196 };
  await assert.rejects(
    confirmedRead(async () => 0, { clientsForRead: [wrong], clock }),
    (e) => e instanceof ConnectError && e.code === 'WRONG_CHAIN',
  );
  const stale = {
    getChainId: async () => 1952,
    getBlock: async () => {
      attempts++;
      return { ...head, timestamp: 100n };
    },
  };
  await assert.rejects(
    confirmedRead(async () => 0, { clientsForRead: [stale], clock }),
    (e) => e.code === 'STALE_RPC',
  );
  assert.equal(attempts, 3);
});

test('durable proposal is reserved once, shares keeper nonce slot, and survives process restart', () => {
  const dir = mkdtempSync(fileURLToPath(new URL('../.state-test-', import.meta.url)));
  let writer, second, keeper;
  try {
    const path = join(dir, 'connect.sqlite'),
      shared = join(dir, 'operator.sqlite');
    writer = new Journal(path, shared);
    writer.propose('one', { amount: '10' });
    writer.propose('two', { amount: '20' });
    assert.equal(writer.reserve('one', 'h1', 0, 'account'), true);
    writer.close();
    writer = undefined;
    second = new Journal(path, shared);
    assert.equal(second.reserve('one', 'h2', 1, 'account'), false);
    assert.equal(second.get('one').hash, 'h1');
    assert.throws(
      () => second.reserve('two', 'h2', 1, 'account'),
      (e) => e.code === 'OPERATOR_BUSY',
    );
    keeper = new DatabaseSync(shared);
    assert.equal(keeper.prepare('SELECT hash FROM pending').get().hash, 'h1');
    // The keeper can reconcile independently. Connect still remembers its exact unresolved hash.
    keeper.exec('DELETE FROM pending');
    assert.throws(
      () => second.reserve('two', 'h2', 1, 'account'),
      (e) => e.code === 'OPERATOR_BUSY',
    );
    second.settle('one', 'h1', { state: 'confirmed' });
    keeper
      .prepare('INSERT INTO pending(slot,hash,nonce,account) VALUES(1,?,?,?)')
      .run('keeperhash', 1, 'account');
    assert.throws(
      () => second.reserve('two', 'h2', 1, 'account'),
      (e) => e.code === 'OPERATOR_BUSY',
    );
    keeper.exec('DELETE FROM pending');
    assert.equal(second.reserve('two', 'h2', 1, 'account'), true);
  } finally {
    keeper?.close();
    writer?.close();
    second?.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('quote credentials are server-only and an unavailable external quote contains no fabricated price', async () => {
  delete process.env.OKX_API_KEY;
  const result = await handle('sentinel_quote', { from: 'USDC', amountRaw: '1000000' });
  assert.equal(result.structuredContent.result.status, 'blocked');
  assert.equal(result.structuredContent.result.quote, null);
  assert.equal(
    (await handle('sentinel_quote', { from: 'USDC', amountRaw: '1', apiKey: 'injected' }))
      .structuredContent.error.code,
    'INVALID_ARGUMENT',
  );
});

test('a replacement needs a definitive invalidation of the exact still-unsigned proposal', async () => {
  const { canSupersedeUnsigned } = await import('../demo.mjs');
  const id = 'p';
  const invalid = { code: 'PROPOSAL_EXPIRED' };
  const reply = async () => ({
    state: 'not_submitted',
    proposalId: id,
    invalidReason: 'PROPOSAL_EXPIRED',
  });
  assert.equal(await canSupersedeUnsigned(id, invalid, reply), true);
  assert.equal(
    await canSupersedeUnsigned(id, { code: 'RPC_UNAVAILABLE' }, () => {
      throw Error('must not query');
    }),
    false,
  );
  for (const row of [
    { state: 'pending_or_unknown', proposalId: id, hash: 'hash' },
    { state: 'not_submitted', proposalId: id, invalidReason: null },
    { state: 'not_submitted', proposalId: 'another', invalidReason: 'PROPOSAL_EXPIRED' },
  ]) {
    assert.equal(await canSupersedeUnsigned(id, invalid, async () => row), false);
  }
  const dir = mkdtempSync(fileURLToPath(new URL('../.state-test-', import.meta.url)));
  const ledger = new Journal(join(dir, 'connect.sqlite'), join(dir, 'operator.sqlite'));
  try {
    ledger.propose(id, {});
    assert.equal(ledger.invalidateUnsent(id, invalid.code), true);
    assert.throws(
      () => ledger.reserve(id, 'would-be-hash', 5, 'account'),
      (e) => e.code === invalid.code,
    );
    ledger.propose('next', {});
    assert.equal(ledger.reserve('next', 'hash', 5, 'account'), true);
    assert.equal(ledger.invalidateUnsent('next', 'PROPOSAL_CHANGED'), false);
  } finally {
    ledger.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('pending-state profile rejects expanded operator privileges even when repay amount is unchanged', async () => {
  const { matchesPendingGrant } = await import('../execution.mjs');
  const p = { grant: { opMask: 8, remainingDebtRaw: '2000000', expiry: '1234', triggerBps: 4500 } };
  assert.equal(matchesPendingGrant(p, [8, 2000000n, 1234n], 4500), true);
  for (const [grant, trigger] of [
    [[12, 2000000n, 1234n], 4500],
    [[8, 3000000n, 1234n], 4500],
    [[8, 2000000n, 1235n], 4500],
    [[8, 2000000n, 1234n], 4000],
  ]) {
    assert.equal(matchesPendingGrant(p, grant, trigger), false);
  }
});
