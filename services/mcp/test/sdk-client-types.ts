import type { Client } from '../runtime/protocol.mjs';
import { callConnectTool } from '../../../packages/sentinel-sdk/public.mjs';

// A real official transport client satisfies the SDK's public structural interface.
export async function readOperator(client: Client) {
  const { data } = await callConnectTool(client, 'sentinel_get_strategies');
  const remaining: string = data.remainingDebtRaw;
  return remaining;
}
