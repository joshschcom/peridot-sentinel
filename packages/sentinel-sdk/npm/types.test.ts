import { callConnectTool, readTool, type Address, type ConnectClient } from '@peridot/sentinel-sdk';

async function consumer(client: ConnectClient, id: Address) {
  const positions = await readTool('sentinel_get_positions');
  const idle: bigint = positions.data[0].idleRaw;
  const external = await callConnectTool(client, 'sentinel_get_positions');
  const externalIdle: string = external.data[0].idleRaw;
  const quote = await callConnectTool(client, 'sentinel_quote', {
    from: 'USDC',
    amountRaw: '1000000',
  });
  const price: string | null = quote.quote?.amountOut ?? null;
  const proposal = await callConnectTool(client, 'sentinel_propose_auto_repay');
  const proposed: Address | undefined = proposal.proposal?.id;
  const confirmed = await callConnectTool(client, 'sentinel_get_execution_receipt', {
    proposalId: id,
  });
  if (confirmed.state === 'confirmed') {
    const debt: string = confirmed.after.debtStoredRaw;
    void debt;
  }
  const denial = await callConnectTool(client, 'sentinel_simulate_operator_borrow');
  await callConnectTool(client, 'sentinel_execute_auto_repay', {
    // @ts-expect-error Execution only accepts a proposal ID.
    target: id,
    data: '0x',
    chainId: 1952,
  });
  // @ts-expect-error Financial JSON inputs are decimal strings, never floating-point numbers.
  await callConnectTool(client, 'sentinel_quote', { from: 'USDC', amountRaw: 1.5 });
  return { idle, externalIdle, price, proposed, denial };
}
void consumer;
