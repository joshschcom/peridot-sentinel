// Run on a fresh local --ops=price position. The single write spends the configured test grant.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {once} from 'node:events';
import {createServer} from 'node:http';
import {execFile,spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {setTimeout as sleep} from 'node:timers/promises';
import {fileURLToPath} from 'node:url';
import {createPublicClient,http} from 'viem';
import {IsolatedControllerAbi} from '@peridot/chain-config';

const rpc = process.env.LOCAL_ANVIL_RPC ?? 'http://127.0.0.1:18549';
assert.equal(new URL(rpc).hostname,'127.0.0.1');
const c = createPublicClient({transport:http(rpc)});
assert.equal(await c.getChainId(),31337);
const meta = await c.request({method:'anvil_metadata'});
assert(meta.instanceId && !meta.forkedNetwork);
const path = 'evidence/session2-ops/local-'+meta.instanceId.slice(2,14);
const root = new URL('../../../',import.meta.url);
const setup = JSON.parse(await readFile(new URL(path+'/price.json',root)));
const manifest = JSON.parse(await readFile(new URL(path+'/manifest.json',root)));
const {account,operator,borrowBlock} = setup.fresh;
const ctl = manifest.markets[0].controller;
const port = '18949', base='http://127.0.0.1:'+port;
const env = {...process.env,KEEPER_CHAIN_ID:'31337',KEEPER_RPC:rpc,KEEPER_OPERATOR:operator,KEEPER_ACCOUNT:account,
  KEEPER_MANIFEST:path+'/manifest.json',KEEPER_INTERVAL_MS:'1000',KEEPER_PORT:port};
const js = name => fileURLToPath(new URL('../dist/'+name+'.js',import.meta.url));
const invoke = promisify(execFile);
const one = async extra => JSON.parse((await invoke(process.execPath,[js('once')],{env:{...env,...extra}})).stdout.trim());
assert.equal((await one({KEEPER_MAX_FEE_WEI:'0'})).state,'gas-budget');
assert.equal((await one({})).state,'simulated');

async function eventually(check) {
  const deadline=Date.now()+20000;
  while (Date.now()<deadline) {
    const result=await check().catch(()=>null);
    if (result) return result;
    await sleep(60);
  }
  throw Error('Keeper smoke timed out');
}
const api = async path => (await fetch(base+path)).json();
const results = {label:'Unforked Anvil, mock assets and development reference processor',source:path,account,operator};
async function withService(extra,args,inspect) {
  const child=spawn(process.execPath,[js('service'),...args],{env:{...env,...extra},stdio:'ignore'});
  const stopped=once(child,'exit');
  try { return await inspect(); }
  finally { child.kill('SIGTERM'); await stopped; }
}
await withService({},['--execute'],async ()=>{
  const activity=await eventually(async ()=>{
    const records=await api('/v1/activity?limit=50');
    return records.items.some(r=>r.state==='simulation-failed') && records.items.some(r=>r.state==='success') ? records : null;
  });
  const status=await api('/v1/status');
  assert.equal(status.environment,'anvil');
  assert.equal(status.instanceId,meta.instanceId);
  assert.equal(status.execute,true);
  assert.equal((await fetch(base+'/v1/activity?limit=101')).status,400);
  assert.equal((await fetch(base+'/v1/activity',{method:'POST'})).status,405);
  assert.equal((await fetch(base+'/v1/private')).status,404);
  const receipts=activity.items.filter(r=>r.state==='success');
  assert.equal(receipts.length,1);
  const rc=await c.getTransactionReceipt({hash:receipts[0].hash});
  assert.equal(rc.status,'success');
  assert.equal(20_000_000n,BigInt(receipts[0].outcomes[0].amount));
  assert.equal(activity.items.find(r=>r.state==='simulation-failed').hash,undefined);
  for (const state of ['gas-budget','simulated','submitted','success','simulation-failed']) assert(activity.items.some(r=>r.state===state));
  results.activity=activity; results.status=status;
});
// Both approvers must come from contracts tied to this account; same transaction and input state.
const approvals=await c.getContractEvents({address:[ctl,account],abi:IsolatedControllerAbi,eventName:'PolicyAllowed',
  args:{account},fromBlock:BigInt(borrowBlock),toBlock:BigInt(borrowBlock),strict:true});
assert.equal(approvals.length,2);
assert.equal(approvals[0].transactionHash,approvals[1].transactionHash);
assert.equal(approvals[0].args.postLtvBps,approvals[1].args.postLtvBps);
assert.equal(approvals[0].args.op,2);
assert.equal(approvals[1].args.op,2);
results.approvals=approvals.map(l=>({emitter:l.address,hash:l.transactionHash,logIndex:l.logIndex,args:l.args}));

// Fault-injected loopback proxy. Refuse chain-ID reads and permit only the metadata read at startup.
let refused=0;
const proxy=createServer(async (req,res)=>{
  let body='';
  for await (const part of req) body+=part;
  const request=JSON.parse(body);
  if(request.method==='eth_chainId') refused++;
  res.setHeader('content-type','application/json');
  res.end(JSON.stringify(request.method==='anvil_metadata'
    ? {jsonrpc:'2.0',id:request.id,result:meta}
    : {jsonrpc:'2.0',id:request.id,error:{code:-32000,message:'Simulated RPC outage'}}));
});
await new Promise(resolve=>proxy.listen(0,'127.0.0.1',resolve));
try {
  await withService({KEEPER_RPC:'http://127.0.0.1:'+proxy.address().port,KEEPER_INTERVAL_MS:'10000',KEEPER_MAX_RETRIES:'1'},[],async ()=>{
    const status=await eventually(async ()=>{ const s=await api('/v1/status');return s.phase==='degraded'?s:null; });
    assert.equal(status.attempt,2);
    assert.equal(status.lastOutcome,'tick-failed');
    assert.equal(refused,2);
    results.faultInjection={refused,status};
  });
} finally { await new Promise(resolve=>proxy.close(resolve)); }
console.log(JSON.stringify(results,(_,v)=>typeof v==='bigint'?v.toString():v,2));
