# @peridot/sentinel-sdk

The npm package lives in `packages/sentinel-sdk/npm` to keep the pinned root workspaces unchanged. The repo entrypoint is `packages/sentinel-sdk/public.mjs`. Read the committed X Layer testnet v1 Sentinel profile through the same implementation as the Connect MCP server. `readTool` returns a typed, hash-pinned observation with financial values in bigint raw units and USD values scaled by 10¹⁸.

```ts
import { readTool } from '@peridot/sentinel-sdk'

const { block, data: positions } = await readTool('sentinel_get_positions')
for (const position of positions) {
  console.log(block.number, position.symbol, position.idleRaw, position.borrowedStoredRaw)
}
```

The SDK's public reads and simulations need no signer. Proposal storage, signing and evidence belong to the server host. The MCP README documents the fixed operator and client interface. [Connect instructions](../../services/mcp/README.md)

When a host supplies a connected MCP client, `callConnectTool` infers inputs and results for all twelve tools. A proposal is a local handle. Only the configured stdio server can decide to sign it.

```ts
import { callConnectTool } from '@peridot/sentinel-sdk'

const simulation = await callConnectTool(client, 'sentinel_simulate_auto_repay')
const quote = await callConnectTool(client, 'sentinel_quote', { from: 'USDC', amountRaw: '1000000' })
console.log(simulation.data.eligible, quote.status)
```

Run the SDK consumer type check from the repository root.

```sh
node_modules/.bin/tsc --strict --noEmit --skipLibCheck --target ES2022 --module NodeNext --moduleResolution NodeNext packages/sentinel-sdk/types.test.ts services/mcp/test/sdk-client-types.ts
```
