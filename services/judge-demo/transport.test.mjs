import assert from 'node:assert/strict'
import test from 'node:test'
import {encodeFunctionData,parseAbi} from 'viem'
import {guardOperatorIntent,wad} from './transport.mjs'

const tokens='0x0000000000000000000000000000000000000001'
const borrower='0x0000000000000000000000000000000000000002'
const account='0x0000000000000000000000000000000000000003'
const m={contracts:{account,mockWokb:tokens},markets:{A:{account:borrower}},grants:{swap:{expiry:'750'}}}
const abi=parseAbi(['function autoRepay()','function borrow(uint256)','function swapExactIn(address,uint256,uint256,uint64)'])
const encode=(functionName,args=[])=>encodeFunctionData({abi,functionName,args})

test('signer accepts only the campaign targets, precise typed calldata, gas policy and zero value',()=>{
  const ok=encode('swapExactIn',[tokens,wad/4n,19_800_000n,750n])
  assert.doesNotThrow(()=>guardOperatorIntent(m,'swap',account,ok,0n,'success'))
  assert.doesNotThrow(()=>guardOperatorIntent(m,'repay',borrower,encode('autoRepay'),0n,'success'))
  assert.doesNotThrow(()=>guardOperatorIntent(m,'deny-operator',account,encode('borrow',[1n]),0n,'reverted',300_000n))
  for(const [target,calldata,value,expected,gas] of [
    [borrower,ok,0n,'success'],[account,ok,1n,'success'],[account,ok,0n,'reverted'],[account,ok,0n,'success',50_000n],
    [account,encode('swapExactIn',[tokens,wad,19_800_000n,750n]),0n,'success'],[account,encode('swapExactIn',[tokens,wad/4n,1n,750n]),0n,'success'],
    [account,encode('swapExactIn',[tokens,wad/4n,19_800_000n,751n]),0n,'success'],[account,encode('borrow',[1n]),0n,'success'],
  ])assert.throws(()=>guardOperatorIntent(m,'swap',target,calldata,value,expected,gas))
  assert.throws(()=>guardOperatorIntent(m,'deny-operator',account,encode('borrow',[2n]),0n,'reverted',300_000n))
})
