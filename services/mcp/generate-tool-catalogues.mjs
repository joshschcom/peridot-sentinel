// Generate both frontend catalogues through MCP discovery. Discovery never invokes a tool.
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Client, StdioClientTransport } from './runtime/protocol.mjs';

// The wire protocol describes arguments. These reviewed notes describe the effects of
// the handlers in execution.mjs, the read SDK, and the v2 campaign policy and state.
const guarantees = {
  sentinel_get_portfolio: [
    'none',
    'Values the configured 1952 account using fresh mock oracle prices at the verified block.',
    'Reports idle assets, stored supply and debt separately in test USD.',
  ],
  sentinel_get_positions: [
    'none',
    'Reads token balances and lending-book snapshots for the configured account at the same verified block.',
  ],
  sentinel_get_markets: [
    'none',
    'Reads the markets in the 1952 manifest and checks each controller’s books against its manifest addresses.',
  ],
  sentinel_get_rates: [
    'none',
    'Checks the configured rate model and calculates simple APR using its on-chain blocksPerYear and each book’s per-block rate.',
  ],
  sentinel_get_policies: [
    'none',
    'Reads the attached market and account policy IDs and returns their registry entries at the verified block. A zero ID has a null entry.',
  ],
  sentinel_get_strategies: [
    'none',
    'Reports the actual trigger and grant for the fixed operator. A live repay-only grant requires mask 8, a positive budget and an unexpired grant.',
  ],
  sentinel_simulate_auto_repay: [
    'none',
    'Checks the repay-only grant, trigger and mock price freshness before simulating autoRepay as the fixed operator.',
    'An eligible amount is positive and within the observed grant.',
  ],
  sentinel_propose_auto_repay: [
    'propose',
    'Only an eligible simulation produces a saved proposal. The proposal binds the account, operator, grant, amount and block for five minutes.',
  ],
  sentinel_execute_auto_repay: [
    'execute',
    'Requires an enabled dedicated operator and a local proposal. Rechecks the grant and simulated amount before signing a zero-value autoRepay call to the configured 1952 account.',
    'Reserves the hash and nonce before submission. An uncertain submission can be reconciled by its original ID.',
  ],
  sentinel_quote: [
    'none',
    'Requests an informational OKX quote for WOKB and native USDC on chain 196. Missing credentials or an unavailable provider return a blocked status and null quote.',
  ],
  sentinel_simulate_operator_borrow: [
    'none',
    'Simulates borrowing 1,000,000 raw mUSD units as the configured operator. Reports the observed contract result through eth_call.',
  ],
  sentinel_get_execution_receipt: [
    'reconcile',
    'Looks up the submitted hash by local proposal ID. For a confirmed repayment, checks the canonical transaction and both the account and debt-book events.',
  ],
  read_account: [
    'read',
    'Checks account, adapter and circuit bindings against the 1952 manifest. Reads actual lending-book exposure and idle mock assets separately.',
    'Includes recorded submissions for the fixed campaign from the local journal.',
  ],
  read_market: [
    'none',
    'Returns the on-chain mock quote and policy minimum for the chosen input on 1952. The separate informational OKX quote on chain 196 can be unavailable.',
  ],
  simulate_and_propose_swap: [
    'propose',
    'Checks the current grant, idle input and campaign cap. Simulates the operator’s exact mock WOKB input and minimum mock USDC output before saving a new proposal.',
    'The saved proposal fixes the account, route, raw amounts and five-minute deadline.',
  ],
  execute_swap: [
    'execute',
    'Rechecks the proposal, grant and pending simulation before signing a zero-value call to the configured 1952 account. Swap output goes to that account.',
    'The journal allows at most one submitted swap per campaign and reserves the signed hash before broadcast.',
  ],
  simulate_denied_borrow: [
    'propose',
    'A new negative-demo proposal requires an absent borrow grant and an eth_call returning OperatorNotAuthorized for the fixed one-raw-unit borrow.',
  ],
  mine_denied_borrow: [
    'execute',
    'Requires both execution and mined-rejection enablement. Rechecks the absent grant and exact denial before submitting the fixed one-raw-unit borrow with a 300,000 gas limit.',
    'The journal allows at most one submitted negative-demo transaction per campaign. A mined revert spends test OKB gas.',
  ],
  get_receipt: [
    'reconcile',
    'Checks the reserved hash and signed transaction against the canonical block. Swap verification checks settlement events, approvals and balance changes.',
    'Negative-demo verification checks the reverted receipt, empty logs and authorization replay. Receipt-window state mismatches are reported for review.',
  ],
};

export const profiles = [
  { name: 'sentinel-connect', directory: new URL('./', import.meta.url) },
  { name: 'sentinel-connect-v2', directory: new URL('../mcp-v2/', import.meta.url) },
];

export async function discoverTools({ name, directory }) {
  const client = new Client({ name: 'sentinel-tool-catalogue', version: '1.0.0' });
  try {
    await client.connect(new StdioClientTransport({
      command: process.execPath,
      args: [fileURLToPath(new URL('server.mjs', directory))],
      env: {},
    }));
    const server = client.getServerVersion();
    assert.equal(server?.name, name);
    const tools = [];
    let cursor;
    do {
      const page = await client.listTools({ cursor });
      tools.push(...page.tools);
      cursor = page.nextCursor;
    } while (cursor);
    return { server, tools };
  } finally {
    await client.close();
  }
}

export function buildCatalogue({ server, tools }) {
  return {
    schemaVersion: 1,
    server,
    writesMeaning: 'True when the tool can submit an on-chain transaction.',
    journalEffects: {
      none: 'No proposal journal access.',
      read: 'Reads existing proposal records. Opening the journal can initialize local storage.',
      propose: 'May save a simulated proposal locally.',
      execute: 'May reserve a signed transaction and record its outcome locally.',
      reconcile: 'May record a confirmed outcome and release the pending nonce locally.',
    },
    tools: tools.map(tool => {
      assert(Object.hasOwn(guarantees, tool.name), 'Missing reviewed guarantees for ' + tool.name);
      const [journalEffect, ...notes] = guarantees[tool.name];
      return { ...tool, writes: journalEffect === 'execute', journalEffect, guarantees: notes };
    }),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // Complete both discovery calls before replacing either checked-in file.
  const catalogues = (await Promise.all(profiles.map(discoverTools))).map(buildCatalogue);
  for (const [index, catalogue] of catalogues.entries()) {
    const file = new URL('tools.json', profiles[index].directory);
    writeFileSync(file, JSON.stringify(catalogue, null, 2) + '\n');
    console.log(catalogue.server.name, catalogue.tools.length, fileURLToPath(file));
  }
}
