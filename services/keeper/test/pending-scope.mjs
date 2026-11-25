// A legacy reservation has no account, and one operator may manage multiple Sentinel accounts.
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {keeperConfig} from '../dist/config.js';
import {runOnce} from '../dist/worker.js';
import {recentActivity} from '../dist/activity.js';

const config = await keeperConfig();
assert.equal(config.environment,'anvil');
const lane = {...config,directory:new URL('scope-test-'+Date.now()+'/',config.directory)};
await mkdir(lane.directory,{recursive:true});
const db = new DatabaseSync(fileURLToPath(new URL('operator.sqlite',lane.directory)));
const hash='0x'+'a5'.repeat(32);
try {
  db.exec('CREATE TABLE pending(slot INTEGER PRIMARY KEY,hash TEXT NOT NULL,nonce INTEGER NOT NULL)');
  db.prepare('INSERT INTO pending VALUES(1,?,0)').run(hash);
  assert.equal(await runOnce(lane,false),'another-transaction-pending');
  db.prepare('UPDATE pending SET account=?').run(config.factory);
  assert.equal(await runOnce(lane,false),'another-transaction-pending');
  const {items} = await recentActivity(lane,100);
  assert.equal(items.length,2);
  assert(items.every(x=>!x.hash));
  db.prepare('UPDATE pending SET account=?').run(config.account);
  assert.equal(await runOnce(lane,false),'awaiting-confirmation');
  assert.equal((await recentActivity(lane,1)).items[0].hash,hash);
  assert.equal(db.prepare('SELECT count(*) AS n FROM pending').get().n,1);
  console.log('3 pending-scope checks passed; simulated journal, no transaction sent.');
} finally { db.close(); }
