import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {activityCoverageView} from '../src/activity-coverage.ts';

const firstHash = '0x' + '11'.repeat(32);
const anchorHash = '0x' + '22'.repeat(32);
const tailHash = '0x' + '33'.repeat(32);
const legacy = {fromBlock:'10', toBlock:'20', toBlockHash:firstHash, gaps:[]};
const recovered = {
  ...legacy, toBlock:'90', toBlockHash:tailHash,
  gaps:[{fromBlock:'21',toBlock:'78',reason:'history-unavailable'}],
  segments:[
    {...legacy, sourceCoverage:'configured'},
    {fromBlock:'79',toBlock:'90',fromBlockHash:anchorHash,toBlockHash:tailHash,sourceCoverage:'known-emitters'},
  ],
};

test('legacy committed range remains visible when a live RPC cannot check its terminal', () => {
  const view = activityCoverageView(legacy, null);
  assert.equal(view.checkpoint,'unavailable');
  assert.equal(view.historicalSegments[0].toBlockHash, firstHash);
  assert.equal(view.mergeableTail,null);
  assert.equal(activityCoverageView(legacy,firstHash).mergeableTail.fromBlock,'10');
});

test('a matching current checkpoint only anchors the last segment; a mismatch preserves the historical segments', () => {
  const view = activityCoverageView(recovered,tailHash);
  assert.deepEqual(view.mergeableTail,recovered.segments[1]);
  assert.equal(view.historicalSegments.length,2);
  assert.deepEqual(view.gaps,recovered.gaps);
  const conflict = activityCoverageView(recovered,anchorHash);
  assert.equal(conflict.checkpoint,'conflict');
  assert.equal(conflict.mergeableTail,null);
  assert.deepEqual(conflict.historicalSegments,recovered.segments);
});

test('an undeclared hole, a missing anchor and contradictory terminal hashes fail closed', () => {
  assert.throws(()=>activityCoverageView({...recovered,gaps:[]},null),/disagree/);
  assert.throws(()=>activityCoverageView({...recovered,segments:undefined},null),/disagree/);
  const missing=structuredClone(recovered);
  delete missing.segments[1].fromBlockHash;
  assert.throws(()=>activityCoverageView(missing,null),/anchor/);
  assert.throws(()=>activityCoverageView({...recovered,toBlockHash:firstHash},null),/terminal/);
  assert.throws(()=>activityCoverageView({...legacy,gaps:[{fromBlock:'12',toBlock:'14',reason:'awaiting-index'}]},null),/gap/);
});

test('both shipped historical files remain readable with no live RPC', () => {
  for (const path of ['../activity/1952.json','../../../deployments/session7/1952/judge-01/activity.json']) {
    const snapshot=JSON.parse(readFileSync(new URL(path,import.meta.url)));
    const view=activityCoverageView(snapshot.coverage,null);
    for (const e of snapshot.events) {
      assert(view.historicalSegments.some(s=>BigInt(s.fromBlock)<=BigInt(e.blockNumber) && BigInt(e.blockNumber)<=BigInt(s.toBlock)));
      assert.match(e.transactionHash,/^0x[0-9a-f]{64}$/i);
      assert.match(e.blockHash,/^0x[0-9a-f]{64}$/i);
    }
    assert.equal(view.mergeableTail,null);
  }
});
