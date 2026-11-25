import { readFile, writeFile } from 'node:fs/promises';

const names = [
  'PolicyRegistry', 'TapeOutPolicyAdapter', 'DevelopmentReferenceProcessor', 'MarketFactory',
  'IsolatedController', 'MarketPToken', 'TestnetOracle', 'TestnetToken', 'SentinelAccount', 'SentinelAccountFactory',
  'DemoRateModel'
];
const declarations = await Promise.all(names.map(async (name) => {
  const path = new URL(`../../../contracts/out/${name}.sol/${name}.json`, import.meta.url);
  const { abi } = JSON.parse(await readFile(path, 'utf8'));
  if (!Array.isArray(abi) || abi.length === 0) throw Error(`Missing ABI: ${name}`);
  // Keep one JSON entry per line for readable diffs and literal viem type inference.
  return `export const ${name}Abi = [\n${abi.map(item => '  ' + JSON.stringify(item)).join(',\n')}\n] as const;\n`;
}));
await writeFile(new URL('../src/abis.ts', import.meta.url),
  '// Generated from Foundry artifacts by npm run generate.\n' + declarations.join('\n'));
