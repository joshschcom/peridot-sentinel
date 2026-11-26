import test from 'node:test'
import assert from 'node:assert/strict'
import { binding, packet, verifyCalls } from './checks.mjs'
import { receiptEvent } from '../../docs/coordination/D8b-postpublish.mjs'

test('the reviewed four envelopes encode only NAND mint and the three exact programs', () => {
  assert.equal(verifyCalls(packet.proposedMainnetCalls).length,4)
  for (const [index,change] of [
    [0,{to:binding.cpu}], [1,{data:'0x095ea7b3'}], [2,{data:packet.proposedMainnetCalls[1].data}],
    [1,{data:packet.proposedMainnetCalls[1].data+'00'}], [2,{value:'0x1'}], [2,{gas:'0xffff'}],
    [3,{maxFeePerGas:'0xffffff'}], [3,{accessList:[{}]}], [3,{nonce:4}], [1,{chainId:'0x1'}],
  ]) {
    const copy=structuredClone(packet.proposedMainnetCalls)
    Object.assign(copy[index],change)
    assert.throws(()=>verifyCalls(copy))
  }
})

test('rehearsal receipt IDs come from the CPU event with exact author, gate count and state bits', () => {
  const signer=packet.pin.simulationSender
  for(const [i,receipt] of packet.forkRehearsal.slice(1).entries()) {
    const gates=packet.evaluations[i].dimensions[3]
    assert.equal(receiptEvent(receipt,signer,gates),BigInt(i+2))
    assert.throws(()=>receiptEvent(receipt,binding.cpu,gates),/Wrong circuit author/)
    assert.throws(()=>receiptEvent(receipt,signer,gates+1),/Wrong gate count/)
    assert.throws(()=>receiptEvent({logs:[]},signer,gates),/Expected one CPU/)
  }
})
