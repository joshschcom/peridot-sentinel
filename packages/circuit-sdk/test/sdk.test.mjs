import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import {
  Op, canonicalPolicyJson, compilePolicy, encodeContext, evaluateNetlist, hashPolicySpec, validatePolicySpec,
} from '../dist/index.js'

const fixture = JSON.parse(readFileSync(new URL('../fixtures/policies-v1.json', import.meta.url)))
const [market, account] = fixture.policies
const base = {op: Op.BORROW, oracleFresh: true, postLtvBps: 5000n, cashOk: true}

test('three byte context agrees with independent little-endian vectors', () => {
  assert.equal(encodeContext({op: Op.SUPPLY, oracleFresh: false, postLtvBps: 0, cashOk: false}), '0x000000')
  assert.equal(encodeContext(base), '0x12710a')
  assert.equal(encodeContext({...base, op: Op.TRANSFER, postLtvBps: 10_000}), '0x19e20c')
  for (const postLtvBps of [-1, 10_001, 0.25, NaN, Infinity, 2n ** 200n]) {
    assert.throws(() => encodeContext({...base, postLtvBps}), RangeError)
  }
  assert.throws(() => encodeContext({...base, cashOk: 1}), TypeError)
  assert.throws(() => encodeContext({...base, op: 10}), RangeError)
})

test('canonical hashing is independent of labels, key order and operation-list order', () => {
  const changed = {...account.spec, label: 'Visible title', params: {allowedOps: [5, 1, 2, 0], maxLtvBps: 5500}}
  assert.equal(hashPolicySpec(changed), account.configHash)
  assert.equal(compilePolicy(changed).netlist, account.netlist)
  assert.equal(canonicalPolicyJson(changed),
    '{"kind":"ACCOUNT","params":{"allowedOps":[0,1,2,5],"maxLtvBps":5500},"schema":"peridot.policy/v1","templateId":"account-guard-v0","templateVersion":0}')
  assert.notEqual(hashPolicySpec({...account.spec, params: {...account.spec.params, maxLtvBps: 5501}}), account.configHash)
})

test('rejects ambiguous or unsupported template inputs', () => {
  for (const bad of [
    {...market.spec, kind: 'ACCOUNT'}, {...market.spec, schema: 'peridot.policy/v0'}, {...market.spec, templateVersion: 1},
    {...market.spec, params: {...market.spec.params, requireCashReserve: 0}}, {...market.spec, label: 17},
    {...market.spec, params: {...market.spec.params, override: true}},
    {...account.spec, params: {...account.spec.params, allowedOps: [1, 1]}},
    {...account.spec, params: {...account.spec.params, allowedOps: ['BORROW']}},
    {...account.spec, params: {...account.spec.params, allowedOps: [10]}},
    {...account.spec, params: {...account.spec.params, maxLtvBps: -1}},
  ]) assert.throws(() => validatePolicySpec(bad))
})

for (const {spec, vectors, ...artifact} of fixture.policies) {
  test(`${spec.kind} compiles to the checked-in bytes and evaluates boundary vectors`, () => {
    assert.deepEqual(compilePolicy(spec), artifact)
    for (const {context, inputs, output} of vectors) {
      assert.equal(encodeContext(context), inputs)
      assert.equal(evaluateNetlist(artifact.netlist, artifact.nIn, artifact.nOut, inputs), output)
    }
  })
}

test('numeric comparator handles each bit weight, inclusive limits, and extreme literals', () => {
  const thresholds = new Set([0, 1, 9999, 10_000])
  for (let bit = 0; bit < 14; bit++) thresholds.add(1 << bit)
  for (const maxLtvBps of thresholds) {
    const circuit = compilePolicy({...market.spec, params: {maxLtvBps, requireCashReserve: false}})
    for (const postLtvBps of [0, Math.max(0, maxLtvBps - 1), maxLtvBps, Math.min(10_000, maxLtvBps + 1), 10_000]) {
      const inputs = encodeContext({...base, postLtvBps, cashOk: false})
      assert.equal(evaluateNetlist(circuit.netlist, 20, 1, inputs), postLtvBps <= maxLtvBps ? '0x01' : '0x00')
    }
  }
})

test('account allow list implements empty, sparse and full operation sets', () => {
  for (const allowedOps of [[], [Op.REDEEM, Op.REBALANCE, Op.TRANSFER], Object.values(Op)]) {
    const circuit = compilePolicy({...account.spec, params: {...account.spec.params, allowedOps}})
    for (const op of Object.values(Op)) {
      assert.equal(evaluateNetlist(circuit.netlist, 20, 1, encodeContext({...base, op})),
        allowedOps.includes(op) ? '0x01' : '0x00')
    }
  }
})

test('TAP-02 NAND evaluator implements input padding, short reads, backward references and final-output slicing', () => {
  const nand = '0x00000002000003'
  for (const [inputs, output] of [['0x', '0x01'], ['0x02', '0x01'], ['0x03', '0x00'], ['0xffca', '0x00']]) {
    assert.equal(evaluateNetlist(nand, 2, 1, inputs), output)
  }
  assert.equal(evaluateNetlist('0x0000000000000100000001000001', 0, 2, '0x'), '0x01')
  for (const bad of [nand.slice(0, -2), '0x00000004000002', '0x02000000000000', '0x01000000000000', '0x']) {
    assert.throws(() => evaluateNetlist(bad, 2, 1, '0x'))
  }
  assert.throws(() => evaluateNetlist(nand, 2, 2, '0x'))
})
