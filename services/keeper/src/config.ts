import {readFile, realpath} from 'node:fs/promises';
import {resolve,relative,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {getAddress,isAddress} from 'viem';
import type {DeploymentManifest} from '@peridot/chain-config';

function configuredAddress(name: string) {
  const value = process.env[name];
  if (!value || !isAddress(value)) throw Error(`Expected an address in ${name}`);
  return getAddress(value);
}

export async function localInstance(rpc: URL) {
  const response = await fetch(rpc,{method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({jsonrpc:'2.0',id:1,method:'anvil_metadata',params:[]}),signal:AbortSignal.timeout(5000)});
  if (!response.ok) throw Error('Local node metadata unavailable');
  const {result} = await response.json();
  if (!/^0x[0-9a-f]{64}$/i.test(result?.instanceId ?? '')) throw Error('Local mode requires Anvil');
  return {instanceId:result.instanceId as string,forked:Boolean(result.forkedNetwork)};
}

export async function keeperConfig() {
  const chainId = Number(process.env.KEEPER_CHAIN_ID);
  if (chainId !== 1952 && chainId !== 31337) throw Error('Keeper requires chain 31337 or 1952');
  const rpc = new URL(process.env.KEEPER_RPC ?? (chainId === 31337 ? 'http://127.0.0.1:8545' : 'https://testrpc.xlayer.tech'));
  if (chainId === 31337 && !['127.0.0.1','localhost','[::1]'].includes(rpc.hostname)) throw Error('Local mode requires loopback RPC');
  if (chainId === 1952 && (rpc.protocol !== 'https:' || !['testrpc.xlayer.tech','xlayertestrpc.okx.com'].includes(rpc.hostname))) {
    throw Error('Use the official testnet RPC for testnet signing');
  }
  const root = fileURLToPath(new URL('../../../',import.meta.url));
  const path = process.env.KEEPER_MANIFEST ?? `packages/chain-config/deployments/${chainId}.json`;
  const manifestPath = await realpath(resolve(root,path));
  const fromRoot = relative(root,manifestPath);
  if (fromRoot.startsWith('..') || isAbsolute(fromRoot)) throw Error('Use a repository deployment manifest');
  const m: DeploymentManifest = JSON.parse(await readFile(manifestPath,'utf8'));
  if (m.chainId !== chainId || m.status !== 'deployed' || m.abiVersion !== 'v1' ||
      m.profile !== (chainId === 31337 ? 'local' : 'testnet')) throw Error('Deployment is unavailable');
  const factory = getAddress(m.contracts.SentinelAccountFactory);
  const account = configuredAddress('KEEPER_ACCOUNT');
  const operator = configuredAddress('KEEPER_OPERATOR');
  if (operator === getAddress('0x8C1741a53d5FB97D74C1d105b0fbFbb4740d5D67')) throw Error('Use a separately revocable operator');
  const instance = chainId === 31337 ? await localInstance(rpc) : null;
  const environment = chainId === 1952 ? 'xlayer-testnet' : instance?.forked ? 'anvil-fork' : 'anvil';
  const lane = instance ? `${chainId}/${instance.instanceId}` : String(chainId);
  const directory = new URL(`../.state/${lane}/${factory}/${operator}/`,import.meta.url);
  return {chainId:chainId as 1952|31337,rpc,factory,account,operator,directory,environment,instanceId:instance?.instanceId ?? null};
}
export type KeeperConfig = Awaited<ReturnType<typeof keeperConfig>>;
