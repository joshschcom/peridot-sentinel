import { fileURLToPath } from 'node:url';
import { createWalletClient, getAddress, http, keccak256, parseEventLogs, toHex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { MarketPTokenAbi, SentinelAccountAbi, TestnetTokenAbi } from '@peridot/chain-config';
import {
  clients,
  confirmedRead,
  ConnectError,
  endpoints,
  fail,
  jsonSafe,
  profile,
  readTool,
} from '../../packages/sentinel-sdk/index.mjs';
import { Journal } from './journal.mjs';

let store;
function journal() {
  return (store ??= new Journal(
    fileURLToPath(new URL('.state/proposals.sqlite', import.meta.url)),
    fileURLToPath(
      new URL(
        '../keeper/.state/1952/' + profile.factory + '/' + profile.operator + '/operator.sqlite',
        import.meta.url,
      ),
    ),
  ));
}
const maxFeeWei = 1_000_000_000_000_000n;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const eq = (a, b) => a && b && getAddress(a) === getAddress(b);
export async function propose() {
  const snapshot = await readTool('sentinel_simulate_auto_repay');
  if (!snapshot.data.eligible) return { ...snapshot, proposal: null };
  const body = jsonSafe({
    chainId: 1952,
    account: profile.account,
    operator: profile.operator,
    commit: profile.deploymentCommit,
    selector: profile.selector,
    valueWei: 0,
    amountRaw: snapshot.data.amountRaw,
    grant: snapshot.data.grant,
    block: snapshot.block,
    validUntil: snapshot.block.timestamp + 300n,
  });
  const id = keccak256(toHex(JSON.stringify(body)));
  journal().propose(id, body);
  return {
    ...snapshot,
    proposal: {
      id,
      ...body,
      settlement: 'Final amount follows the on-chain grant, debt and account funds at inclusion.',
    },
  };
}

async function postState(ctx) {
  const [debtStoredRaw, walletDebtAssetRaw, grant] = await Promise.all([
    ctx.read(profile.debtMarket, MarketPTokenAbi, 'borrowBalanceStored', [profile.account]),
    ctx.read(profile.debtAsset, TestnetTokenAbi, 'balanceOf', [profile.account]),
    ctx.read(profile.account, SentinelAccountAbi, 'operators', [profile.operator]),
  ]);
  return { debtStoredRaw, walletDebtAssetRaw, remainingGrantRaw: grant[1] };
}
export async function verifySettlement(id, hash, nonce, receipt) {
  const observed = await confirmedRead(
    async (ctx) => {
      if (ctx.block.hash !== receipt.blockHash || receipt.transactionHash !== hash)
        fail('STALE_RPC', 'Receipt block changed');
      const tx = await ctx.client.getTransaction({ hash: hash });
      if (
        !eq(tx.from, profile.operator) ||
        !eq(tx.to, profile.account) ||
        tx.nonce !== nonce ||
        tx.value !== 0n ||
        tx.input !== profile.selector ||
        tx.chainId !== 1952 ||
        tx.blockHash !== receipt.blockHash
      )
        fail('RECEIPT_MISMATCH', 'Confirmed transaction differs from the reserved operation');
      const receiptData = {
        hash: hash,
        blockNumber: receipt.blockNumber,
        blockHash: receipt.blockHash,
        gasUsed: receipt.gasUsed,
        status: receipt.status,
        from: tx.from,
        to: tx.to,
        nonce: tx.nonce,
        selector: tx.input,
        valueWei: tx.value,
        explorer: 'https://www.okx.com/web3/explorer/xlayer-test/tx/' + hash,
      };
      if (receipt.status !== 'success')
        return { state: 'reverted', proposalId: id, receipt: receiptData };
      const events = parseEventLogs({
        abi: SentinelAccountAbi,
        eventName: 'AutoRepayExecuted',
        logs: receipt.logs,
        strict: true,
      }).filter((e) => eq(e.address, profile.account) && eq(e.args.operator, profile.operator));
      const repayments = parseEventLogs({
        abi: MarketPTokenAbi,
        eventName: 'RepayBorrow',
        logs: receipt.logs,
        strict: true,
      }).filter(
        (e) =>
          eq(e.address, profile.debtMarket) &&
          eq(e.args.borrower, profile.account) &&
          eq(e.args.payer, profile.account),
      );
      if (
        events.length !== 1 ||
        repayments.length !== 1 ||
        events[0].args.amount <= 0n ||
        repayments[0].args.repayAmount !== events[0].args.amount
      )
        fail(
          'RECEIPT_MISMATCH',
          'Confirmation lacks the expected Sentinel and debt-book settlement events',
        );
      const after = await postState(ctx);
      const before = await confirmedRead(postState, { at: receipt.blockNumber - 1n });
      return {
        state: 'confirmed',
        proposalId: id,
        receipt: receiptData,
        actual: events[0].args,
        repayBookEvent: repayments[0].args,
        beforeBlock: before.block,
        before: before.data,
        afterBlock: { number: ctx.block.number, hash: ctx.block.hash },
        after,
        stateScope:
          'Before/after are block-end snapshots. Emitted events identify the exact transaction amount.',
      };
    },
    { at: receipt.blockNumber, minimum: receipt.blockNumber },
  );
  return jsonSafe({ ...observed.data, confirmations: observed.block.confirmations, chainId: 1952 });
}

async function reconcile(id, row, wait) {
  const db = journal();
  if (row.outcome) {
    // Recheck the historical block hash even for a cross-process duplicate call.
    const known = JSON.parse(row.outcome);
    const current = await confirmedRead(async ({ block }) => block.hash, {
      at: BigInt(known.receipt.blockNumber),
    });
    if (current.data !== known.receipt.blockHash)
      fail('REORG', 'Previously confirmed receipt block changed; operator review required');
    return known;
  }
  for (let pass = 0; pass < (wait ? 10 : 1); pass++) {
    let receipt;
    for (const rpc of clients) {
      try {
        receipt = await rpc.getTransactionReceipt({ hash: row.hash });
        break;
      } catch {}
    }
    if (receipt) {
      let record;
      try {
        record = await verifySettlement(id, row.hash, row.nonce, receipt);
      } catch (e) {
        if (!(e instanceof ConnectError) || !['STALE_RPC', 'RPC_UNAVAILABLE'].includes(e.code))
          throw e;
        if (wait && pass < 9) {
          await sleep(1000);
          continue;
        }
        return { state: 'awaiting_confirmation', proposalId: id, hash: row.hash, nonce: row.nonce };
      }
      db.settle(id, row.hash, record);
      return record;
    }
    if (wait && pass < 9) await sleep(1000);
  }
  return {
    state: 'pending_or_unknown',
    proposalId: id,
    hash: row.hash,
    nonce: row.nonce,
    instruction:
      'Reconcile this same proposal; a replacement is never automatically signed or sent.',
  };
}

export async function getExecutionReceipt(id) {
  const row = journal().get(id);
  if (!row) fail('UNKNOWN_PROPOSAL', 'No local proposal with that ID');
  if (!row.hash)
    return { state: 'not_submitted', proposalId: id, invalidReason: row.invalidReason };
  // The read tool actually re-fetches the transaction and its events, including for a previously
  // confirmed proposal. The execute tool may return its cached canonical result on a duplicate.
  const record = await reconcile(id, { ...row, outcome: null }, false);
  return { source: 'canonical transaction receipt', ...record };
}

export function matchesPendingGrant(proposal, grant, trigger) {
  return (
    grant[0] === 8 &&
    grant[0] === proposal.grant.opMask &&
    grant[1] === BigInt(proposal.grant.remainingDebtRaw) &&
    grant[2] === BigInt(proposal.grant.expiry) &&
    trigger === proposal.grant.triggerBps
  );
}

export async function execute(id) {
  if (process.env.SENTINEL_ENABLE_EXECUTE !== '1')
    fail('EXECUTION_DISABLED', 'Restricted execution is disabled for this process');
  const db = journal(),
    row = db.get(id);
  if (!row) fail('UNKNOWN_PROPOSAL', 'No local proposal with that ID');
  if (row.hash) return reconcile(id, row, false);
  if (row.invalidReason) fail(row.invalidReason, 'This unsigned proposal is no longer active');
  const decline = (code, message) => {
    if (db.invalidateUnsent(id, code)) fail(code, message);
    fail(
      'PROPOSAL_RESERVED',
      'Another process reserved this proposal; reconcile its original hash',
    );
  };
  const proposed = JSON.parse(row.body);
  const snapshot = await readTool('sentinel_simulate_auto_repay');
  if (snapshot.block.timestamp > BigInt(proposed.validUntil))
    decline('PROPOSAL_EXPIRED', 'Create a new proposal');
  const quote = snapshot.data;
  if (
    !quote.eligible ||
    String(quote.amountRaw) !== proposed.amountRaw ||
    JSON.stringify(jsonSafe(quote.grant)) !== JSON.stringify(proposed.grant)
  )
    decline('PROPOSAL_CHANGED', 'The eligibility, amount, trigger or grant changed');
  const historical = await confirmedRead(async ({ block }) => block.hash, {
    at: BigInt(proposed.block.number),
  });
  if (historical.data !== proposed.block.hash) fail('REORG', 'Proposal block changed');
  let signer;
  const key = process.env.SENTINEL_OPERATOR_KEY;
  try {
    if (key && /^(0x)?[0-9a-fA-F]{64}$/.test(key))
      signer = privateKeyToAccount((key.startsWith('0x') ? '' : '0x') + key);
  } catch {}
  if (!signer || !eq(signer.address, profile.operator) || eq(signer.address, profile.owner))
    fail('SIGNER_MISMATCH', 'The configured dedicated signer does not match the fixed operator');
  const rpc = clients[0];
  if ((await rpc.getChainId()) !== 1952)
    fail('WRONG_CHAIN', 'Public RPC reported an unexpected chain');
  // Recheck the inclusion candidate before signing. It may differ from the confirmed read used for display.
  const latest = await rpc.getBlock({ blockTag: 'latest' });
  if (
    latest.number < snapshot.block.number ||
    latest.timestamp < snapshot.block.timestamp ||
    latest.timestamp > BigInt(proposed.validUntil)
  )
    fail('STALE_RPC', 'RPC head is stale or proposal expired');
  const pendingGrant = await rpc.readContract({
    address: profile.account,
    abi: SentinelAccountAbi,
    functionName: 'operators',
    args: [profile.operator],
    blockTag: 'pending',
  });
  const pendingTrigger = await rpc.readContract({
    address: profile.account,
    abi: SentinelAccountAbi,
    functionName: 'autoRepayTriggerBps',
    blockTag: 'pending',
  });
  if (!matchesPendingGrant(proposed, pendingGrant, pendingTrigger)) {
    decline(
      'PROPOSAL_CHANGED',
      'The pending operator mask, budget, expiry or trigger differs from the proposal',
    );
  }
  const { result } = await rpc.simulateContract({
    address: profile.account,
    abi: SentinelAccountAbi,
    functionName: 'autoRepay',
    account: profile.operator,
    blockTag: 'pending',
  });
  if (result !== quote.amountRaw)
    decline('PROPOSAL_CHANGED', 'Pending simulation amount differs from the proposal');
  const [estimate, gasPrice, balance, nonce] = await Promise.all([
    rpc.estimateGas({ account: profile.operator, to: profile.account, data: profile.selector }),
    rpc.getGasPrice(),
    rpc.getBalance({ address: profile.operator }),
    rpc.getTransactionCount({ address: profile.operator, blockTag: 'pending' }),
  ]);
  const gas = estimate + estimate / 4n + 30000n;
  if (gas * gasPrice > maxFeeWei || gas * gasPrice > balance)
    fail('GAS_BUDGET', 'Fee exceeds the operator balance or configured fixed budget');
  const wallet = createWalletClient({
    chain: profile.chain,
    account: signer,
    transport: http(endpoints[0], { retryCount: 0 }),
  });
  const signed = await wallet.signTransaction({
    chain: profile.chain,
    type: 'legacy',
    nonce,
    gas,
    gasPrice,
    to: profile.account,
    value: 0n,
    data: profile.selector,
  });
  const hash = keccak256(signed);
  if (!db.reserve(id, hash, nonce, profile.account)) return reconcile(id, db.get(id), false);
  // Once reserved, transport uncertainty is resolved only by the exact locally computed hash.
  try {
    const returned = await rpc.sendRawTransaction({ serializedTransaction: signed });
    if (returned !== hash) fail('HASH_MISMATCH', 'Provider returned another hash');
  } catch {
    return {
      state: 'submission_unknown',
      proposalId: id,
      hash,
      nonce,
      instruction: 'Reconcile the same proposal ID.',
    };
  }
  return reconcile(id, db.get(id), true);
}
