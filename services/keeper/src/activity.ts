import {open} from 'node:fs/promises';
import type {KeeperConfig} from './config.js';

// The public reader scans only the newest part of this operator's private append-only journal.
const windowBytes = 256 * 1024;
export async function recentActivity(config: KeeperConfig, limit: number) {
  let file;
  try { file = await open(new URL('activity.jsonl',config.directory),'r'); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {items:[],truncated:false};
    throw error;
  }
  try {
    const {size} = await file.stat();
    const start = Math.max(0,size-windowBytes);
    const data = Buffer.alloc(size-start);
    const {bytesRead} = await file.read(data,0,data.length,start);
    const lines = data.subarray(0,bytesRead).toString('utf8').split('\n');
    // Append writes end in a newline. Ignore partial edge records.
    lines.pop();
    if (start > 0) lines.shift();
    const items = [];
    for (const line of lines.reverse()) {
      const row = JSON.parse(line);
      if (row.chainId !== config.chainId || row.account?.toLowerCase() !== config.account.toLowerCase() ||
          row.operator?.toLowerCase() !== config.operator.toLowerCase()) continue;
      const {at,state,hash,block,gas,amount,trigger,ltv,fee,balance} = row;
      const reason = row.reason ? (/^[a-zA-Z][a-zA-Z0-9_]{0,79}$/.test(row.reason) ? row.reason : 'ExecutionReverted') : undefined;
      const outcomes = row.outcomes?.map((r: Record<string,string>)=>({
        operator:r.operator,amount:r.amount,ltvBeforeBps:r.ltvBeforeBps,ltvAfterBps:r.ltvAfterBps
      }));
      items.push({at,state,hash,block,gas,amount,trigger,ltv,fee,balance,reason,outcomes});
      if (items.length > limit) break;
    }
    return {items:items.slice(0,limit),truncated:start>0 || items.length>limit};
  } finally { await file.close(); }
}
