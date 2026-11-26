import { Client, StdioClientTransport } from './runtime/protocol.mjs';
import { fileURLToPath } from 'node:url';
import { flagship } from './demo.mjs';
import { TOOL_NAMES } from '../../packages/sentinel-sdk/index.mjs';

const [command, argument] = process.argv.slice(2);
if (
  !['inspect', 'simulate', 'propose', 'execute', 'list', 'demo', 'reject', 'quote'].includes(
    command,
  ) ||
  process.argv.length > (command === 'execute' ? 4 : 3) ||
  (command === 'execute' && !/^0x[0-9a-f]{64}$/.test(argument ?? ''))
) {
  console.error(
    'Usage: node services/mcp/client.mjs list | inspect | quote | simulate | reject | propose | execute <proposalId> | demo',
  );
  process.exit(2);
}
// Explicit environment allowlist: do not forward unrelated wallet or provider credentials.
const env = {};
if (command === 'execute' || command === 'demo') {
  if (process.env.SENTINEL_ENABLE_EXECUTE)
    env.SENTINEL_ENABLE_EXECUTE = process.env.SENTINEL_ENABLE_EXECUTE;
  if (process.env.SENTINEL_OPERATOR_KEY)
    env.SENTINEL_OPERATOR_KEY = process.env.SENTINEL_OPERATOR_KEY;
}
if (['demo', 'quote'].includes(command)) {
  for (const k of ['OKX_API_KEY', 'OKX_API_SECRET', 'OKX_API_PASSPHRASE'])
    if (process.env[k]) env[k] = process.env[k];
}
const client = new Client({ name: 'sentinel-demo-external-client', version: '1.0.0' });
try {
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [fileURLToPath(new URL('server.mjs', import.meta.url))],
      env,
      stderr: 'inherit',
    }),
  );
  const { tools } = await client.listTools();
  const record = { transport: 'MCP stdio subprocess', server: client.getServerVersion(), command };
  if (command === 'demo') record.demo = await flagship(client);
  else if (command === 'list') record.tools = tools;
  else {
    const names =
      command === 'inspect'
        ? TOOL_NAMES.slice(0, 7)
        : [
            command === 'execute'
              ? TOOL_NAMES[8]
              : command === 'propose'
                ? TOOL_NAMES[7]
                : command === 'reject'
                  ? TOOL_NAMES[10]
                  : command === 'quote'
                    ? TOOL_NAMES[9]
                    : TOOL_NAMES[6],
          ];
    record.results = {};
    for (const name of names) {
      const result = await client.callTool(
        {
          name,
          arguments:
            command === 'execute'
              ? { proposalId: argument }
              : command === 'quote'
                ? { from: 'USDC', amountRaw: '1000000' }
                : {},
        },
        undefined,
        { timeout: 120000 },
      );
      record.results[name] = result.structuredContent ?? JSON.parse(result.content[0].text);
      if (result.isError) process.exitCode = 1;
    }
  }
  console.log(JSON.stringify(record, null, 2));
} catch {
  console.error('External MCP client could not complete the stdio request.');
  process.exitCode = 1;
} finally {
  await client.close();
}
