import {
  Server,
  StdioServerTransport,
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from './runtime/protocol.mjs';
import {
  ConnectError,
  jsonSafe,
  readTool,
  TOOL_NAMES,
} from '../../packages/sentinel-sdk/index.mjs';
import { execute, getExecutionReceipt, propose } from './execution.mjs';
import { quote } from '../onchainos/quote.mjs';
import { pathToFileURL } from 'node:url';

const descriptions = [
  'Value the configured account in test USD, separating idle funds and stored lending exposure.',
  'Read raw token holdings, pToken shares, underlying supplied and stored borrow balances.',
  'Read activated state, caps, policy IDs and liquidity for manifest-listed v1 markets.',
  'Read variable per-block rates and model-based simple annual rates at the same block.',
  'Read the market and account policy IDs and their actual registry entries.',
  'Read the configured automatic repayment trigger, repay-only operator grant, expiry and budget.',
  'Simulate autoRepay() for the configured testnet operator through a read-only eth_call.',
  'Simulate and persist a five-minute proposal scoped to the configured account, operator and grant.',
  'Submit one locally proposed v1 testnet autoRepay() or reconcile its original hash. Requires explicit operator signer enablement.',
  'Request an informational OKX OnchainOS WOKB/native USDC mainnet quote. Returns unavailable when credentials or service are missing.',
  'Simulate the fixed operator borrowing one mock dollar on 1952 and return the actual decoded contract decision.',
  'Read the canonical receipt and account changes for a specific previously submitted local proposal.',
];
const proposalSchema = { proposalId: { type: 'string', pattern: '^0x[0-9a-f]{64}$' } };
const quoteSchema = {
  from: { type: 'string', enum: ['WOKB', 'USDC'] },
  amountRaw: { type: 'string', pattern: '^[1-9][0-9]{0,77}$' },
};
const schemas = {
  sentinel_quote: quoteSchema,
  sentinel_get_execution_receipt: proposalSchema,
  sentinel_execute_auto_repay: proposalSchema,
};
export const catalog = TOOL_NAMES.map((name, i) => ({
  name,
  description: descriptions[i],
  inputSchema: {
    type: 'object',
    properties: schemas[name] ?? {},
    required: Object.keys(schemas[name] ?? {}),
    additionalProperties: false,
  },
  annotations: {
    readOnlyHint: !['sentinel_propose_auto_repay', 'sentinel_execute_auto_repay'].includes(name),
    destructiveHint: name === 'sentinel_execute_auto_repay',
    idempotentHint: name !== 'sentinel_propose_auto_repay',
    openWorldHint: true,
  },
}));
async function quoteTool(args) {
  const scope = {
    provider: 'OKX OnchainOS',
    kind: 'informational external spot-swap quote',
    chainId: 196,
    from: args.from,
    amountRaw: args.amountRaw,
  };
  if (!['OKX_API_KEY', 'OKX_API_SECRET', 'OKX_API_PASSPHRASE'].every((k) => process.env[k]))
    return { ...scope, status: 'blocked', code: 'OKX_CREDENTIALS_UNAVAILABLE', quote: null };
  try {
    return { ...scope, status: 'quoted', quote: await quote(args.from, args.amountRaw) };
  } catch {
    return { ...scope, status: 'blocked', code: 'OKX_QUOTE_UNAVAILABLE', quote: null };
  }
}
export async function handle(name, args = {}) {
  try {
    if (!TOOL_NAMES.includes(name)) throw new ConnectError('UNKNOWN_TOOL', 'Unknown tool');
    if (args === null || typeof args !== 'object' || Array.isArray(args))
      throw new ConnectError('INVALID_ARGUMENT', 'Expected an object');
    const expected = Object.keys(schemas[name] ?? {});
    if (
      Object.keys(args).length !== expected.length ||
      expected.some((k) => !Object.hasOwn(args, k)) ||
      (expected.includes('proposalId') &&
        (typeof args.proposalId !== 'string' || !/^0x[0-9a-f]{64}$/.test(args.proposalId))) ||
      (name === 'sentinel_quote' &&
        (!['WOKB', 'USDC'].includes(args.from) ||
          typeof args.amountRaw !== 'string' ||
          !/^[1-9][0-9]{0,77}$/.test(args.amountRaw) ||
          BigInt(args.amountRaw) >= 2n ** 256n))
    )
      throw new ConnectError('INVALID_ARGUMENT', 'Input differs from the published tool schema');
    let value;
    switch (name) {
      case 'sentinel_execute_auto_repay':
        value = await execute(args.proposalId);
        break;
      case 'sentinel_get_execution_receipt':
        value = await getExecutionReceipt(args.proposalId);
        break;
      case 'sentinel_quote':
        value = await quoteTool(args);
        break;
      case 'sentinel_propose_auto_repay':
        value = await propose();
        break;
      default:
        value = await readTool(name);
    }
    const payload = jsonSafe(value);
    return {
      content: [{ type: 'text', text: JSON.stringify(payload) }],
      structuredContent: { result: payload },
    };
  } catch (e) {
    const error =
      e instanceof ConnectError
        ? { code: e.code, message: e.message }
        : {
            code: 'REQUEST_FAILED',
            message:
              'Could not complete the requested operation; reconcile a submitted proposal by ID.',
          };
    return {
      isError: true,
      content: [{ type: 'text', text: JSON.stringify(error) }],
      structuredContent: { error },
    };
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = new Server(
    { name: 'sentinel-connect', version: '1.1.0' },
    { capabilities: { tools: {} } },
  );
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: catalog }));
  server.setRequestHandler(CallToolRequestSchema, (req) =>
    handle(req.params.name, req.params.arguments),
  );
  await server.connect(new StdioServerTransport());
}
