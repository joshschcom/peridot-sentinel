import {createServer} from 'node:http';
import {setTimeout as sleep} from 'node:timers/promises';
import {keeperConfig} from './config.js';
import {recentActivity} from './activity.js';
import {runOnce} from './worker.js';

function integer(name: string, fallback: number, min: number, max: number) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isSafeInteger(value) || value < min || value > max) throw Error(`Invalid ${name}`);
  return value;
}

async function serve() {
  const config = await keeperConfig();
  const intervalMs = integer('KEEPER_INTERVAL_MS',30000,1000,3600000);
  const maxRetries = integer('KEEPER_MAX_RETRIES',2,0,3);
  const port = integer('KEEPER_PORT',8787,1,65535);
  const execute = process.argv.includes('--execute');
  const stop = new AbortController();
  const status = {
    execute,intervalMs,maxRetries,phase:'starting',attempt:0,cycles:0,
    startedAt:new Date().toISOString(),lastAt:null as string|null,lastOutcome:null as string|null,
    nextAt:null as string|null
  };
  const scope = {schemaVersion:1,environment:config.environment,instanceId:config.instanceId,chainId:config.chainId,factory:config.factory,account:config.account,operator:config.operator};
  const server = createServer(async (req,res)=>{
    res.setHeader('content-type','application/json; charset=utf-8');
    res.setHeader('cache-control','no-store');
    res.setHeader('access-control-allow-origin','*');
    function reply(code: number, value: unknown) {
      res.writeHead(code);
      res.end(JSON.stringify(value));
    }
    if (req.method !== 'GET') { res.setHeader('allow','GET'); reply(405,{error:'GET required'}); return; }
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      if (url.pathname === '/v1/status') { reply(200,{...scope,...status}); return; }
      if (url.pathname !== '/v1/activity') { reply(404,{error:'Unknown route'}); return; }
      const value = url.searchParams.get('limit') ?? '50';
      if (!/^\d{1,3}$/.test(value) || Number(value)<1 || Number(value)>100) { reply(400,{error:'limit must be 1..100'}); return; }
      reply(200,{...scope,...await recentActivity(config,Number(value))});
    } catch { reply(503,{error:'Activity unavailable'}); }
  });
  await new Promise<void>((resolve,reject)=>{
    server.once('error',reject);
    server.listen(port,process.env.KEEPER_HOST ?? '127.0.0.1',resolve);
  });
  const shutdown = () => stop.abort();
  process.once('SIGTERM',shutdown);
  process.once('SIGINT',shutdown);
  const delay = (ms:number) => sleep(ms,undefined,{signal:stop.signal}).catch(error=>{
    if (!stop.signal.aborted) throw error;
  });
  try {
    while (!stop.signal.aborted) {
      status.cycles++;
      for (let attempt=0; attempt<=maxRetries && !stop.signal.aborted; attempt++) {
        status.phase = 'checking';
        status.attempt = attempt+1;
        status.nextAt = null;
        try {
          status.lastOutcome = await runOnce(config,execute);
          status.lastAt = new Date().toISOString();
          break;
        } catch {
          status.lastOutcome = 'tick-failed';
          status.lastAt = new Date().toISOString();
          if (attempt === maxRetries) break;
          status.phase = 'retrying';
          const retryDelay = Math.min(1000 * 2**attempt,intervalMs);
          status.nextAt = new Date(Date.now()+retryDelay).toISOString();
          await delay(retryDelay);
        }
      }
      if (status.lastOutcome === 'reverted') {
        // An observed on-chain failure merits operator review before sending further transactions.
        status.phase = 'paused-after-revert';
        status.nextAt = null;
        while (!stop.signal.aborted) await delay(60000);
        break;
      }
      status.phase = status.lastOutcome === 'tick-failed' ? 'degraded' : 'waiting';
      status.nextAt = new Date(Date.now()+intervalMs).toISOString();
      await delay(intervalMs);
    }
  } finally {
    process.off('SIGTERM',shutdown);
    process.off('SIGINT',shutdown);
    await new Promise<void>((resolve)=>server.close(()=>resolve()));
  }
}
serve().catch(()=>{
  console.error('Keeper service failed to start or stopped unexpectedly. Check its network, manifest, account and port settings.');
  process.exitCode = 1;
});
