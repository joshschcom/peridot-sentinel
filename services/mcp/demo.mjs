import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const path = fileURLToPath(
  new URL('../../evidence/session5-mcp/flagship-1952.json', import.meta.url),
);
function persist(record) {
  const temporary = path + '.' + process.pid;
  writeFileSync(temporary, JSON.stringify(record, null, 2) + '\n');
  renameSync(temporary, path);
}
export async function canSupersedeUnsigned(id, error, call) {
  if (!['PROPOSAL_EXPIRED', 'PROPOSAL_CHANGED'].includes(error?.code)) return false;
  const status = await call('sentinel_get_execution_receipt', { proposalId: id });
  return (
    status.state === 'not_submitted' &&
    status.proposalId === id &&
    status.invalidReason === error.code
  );
}

export async function flagship(client) {
  if (process.env.SENTINEL_ENABLE_EXECUTE !== '1' || !process.env.SENTINEL_OPERATOR_KEY)
    throw Error('Explicit operator execution environment required');
  const state = new URL('.state/', import.meta.url);
  mkdirSync(state, { recursive: true, mode: 0o700 });
  const lock = new DatabaseSync(fileURLToPath(new URL('flagship.sqlite', state)));
  try {
    lock.exec('BEGIN IMMEDIATE');
    const record = existsSync(path)
      ? JSON.parse(readFileSync(path, 'utf8'))
      : {
          schema: 'sentinel-connect/demo-v1',
          transport: 'External official MCP Client over stdio',
          chainId: 1952,
          server: client.getServerVersion(),
          steps: {},
        };
    if (record.schema !== 'sentinel-connect/demo-v1' || record.chainId !== 1952)
      throw Error('Unexpected saved transcript');
    async function call(name, args = {}) {
      const r = await client.callTool({ name, arguments: args }, undefined, { timeout: 150000 });
      if (r.isError) {
        record.lastError = { tool: name, ...r.structuredContent.error };
        persist(record);
        throw Object.assign(Error(record.lastError.code), { code: record.lastError.code });
      }
      delete record.lastError;
      return r.structuredContent.result;
    }
    async function step(n, fn) {
      if (!record.steps[n]) {
        record.steps[n] = await fn();
        persist(record);
      }
      return record.steps[n];
    }
    async function readBefore() {
      await step(1, async () => ({
        account: await call('sentinel_get_portfolio'),
        positions: await call('sentinel_get_positions'),
      }));
      await step(2, async () => ({
        policies: await call('sentinel_get_policies'),
        authorization: await call('sentinel_get_strategies'),
      }));
      await step(3, () => call('sentinel_quote', { from: 'USDC', amountRaw: '1000000' }));
    }
    await readBefore();
    const prepare = () =>
      step(4, async () => {
        const simulation = await call('sentinel_simulate_auto_repay');
        if (!simulation.data.eligible)
          throw Error('Position is currently ineligible for repayment');
        const proposed = await call('sentinel_propose_auto_repay');
        if (!proposed.proposal?.id) throw Error('No eligible proposal');
        return { simulation, proposed };
      });
    let pre = await prepare();
    let id = pre.proposed.proposal.id;
    if (!record.steps[5] || record.steps[5].state !== 'confirmed') {
      let submitted;
      if (record.steps[5]?.hash) {
        submitted = await call('sentinel_get_execution_receipt', { proposalId: id });
      } else {
        try {
          submitted = await call('sentinel_execute_auto_repay', { proposalId: id });
        } catch (err) {
          const safeToRefresh = await canSupersedeUnsigned(id, err, call);
          if (!safeToRefresh) throw err;
          (record.supersededAttempts ??= []).push({ reason: err.code, steps: { ...record.steps } });
          // Archive the previous grant and positions too; an owner may have replaced the grant.
          record.steps = {};
          delete record.lastError;
          persist(record);
          await readBefore();
          pre = await prepare();
          id = pre.proposed.proposal.id;
          submitted = await call('sentinel_execute_auto_repay', { proposalId: id });
        }
      }
      record.steps[5] = submitted;
      persist(record);
      if (submitted.state !== 'confirmed') {
        for (let i = 0; i < 8 && record.steps[5].state !== 'confirmed'; i++) {
          if (record.steps[5].state === 'reverted') throw Error('Transaction reverted');
          await new Promise((resolve) => setTimeout(resolve, 2500));
          record.steps[5] = await call('sentinel_get_execution_receipt', { proposalId: id });
          persist(record);
        }
        if (record.steps[5].state !== 'confirmed') throw Error('Reconcile the saved proposal ID');
      }
    }
    await step(6, async () => {
      const r = await call('sentinel_simulate_operator_borrow');
      if (!r.data.rejected || r.data.error !== 'OperatorNotAuthorized')
        throw Error('Expected an on-chain simulated operator borrow rejection');
      return r;
    });
    await step(7, async () => {
      const transaction = await call('sentinel_get_execution_receipt', { proposalId: id });
      const updatedAuthorization = await call('sentinel_get_strategies');
      if (
        transaction.state !== 'confirmed' ||
        transaction.receipt.hash !== record.steps[5].receipt.hash ||
        BigInt(updatedAuthorization.block.number) < BigInt(transaction.receipt.blockNumber)
      )
        throw Error('Incoherent final observation');
      return { transaction, updatedAuthorization };
    });
    record.outcome = {
      execution: 'confirmed',
      borrow: 'rejected in read-only eth_call',
      quote: record.steps[3].status,
      hash: record.steps[5].receipt.hash,
      remainingGrantRaw: record.steps[7].updatedAuthorization.data.remainingDebtRaw,
    };
    persist(record);
    return { transcript: 'evidence/session5-mcp/flagship-1952.json', ...record.outcome };
  } finally {
    lock.close();
  }
}
