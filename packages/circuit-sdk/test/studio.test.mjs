import assert from 'node:assert/strict'
import test from 'node:test'
import { hashNetlist, STUDIO_MARKET_ROOT, studioMarketTemplate } from '../dist/index.js'

test('Studio proofs independently reproduce the registry commitment for edge and interior thresholds', () => {
  for (const [bps, reserve] of [[0, false], [0, true], [1, false], [63, true], [64, false], [6234, true], [10000, true]]) {
    const {compiled, proof} = studioMarketTemplate(bps, reserve)
    let index = bps * 2 + Number(reserve)
    let hash = hashNetlist('0x' + bps.toString(16).padStart(4, '0') + (reserve ? '01':'00') +
      compiled.configHash.slice(2) + compiled.netlistHash.slice(2))
    assert.equal(proof.length, 15)
    for (const sibling of proof) {
      hash = hashNetlist(index & 1 ? sibling + hash.slice(2) : hash + sibling.slice(2))
      index >>= 1
    }
    assert.equal(hash, STUDIO_MARKET_ROOT)
  }
})
test('Studio rejects invalid thresholds and reserve choices before producing a proof', () => {
  for (const bps of [-1, 10001, 100.5, NaN]) assert.throws(() => studioMarketTemplate(bps, true))
  assert.throws(() => studioMarketTemplate(5000, 'true'))
})
