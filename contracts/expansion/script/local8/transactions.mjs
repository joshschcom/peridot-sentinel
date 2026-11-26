// Sign through Anvil's unlocked account #0. Journal the exact local transaction before submission.
import assert from 'node:assert/strict'
import {existsSync,mkdirSync} from 'node:fs'
import {DatabaseSync} from 'node:sqlite'
import {createWalletClient,http,keccak256} from 'viem'
import {gasWithHeadroom,readJson,writeJson} from '../session6-transactions.mjs'
import {account0,chain,client,journalDir,rpcUrl,sameAddress} from './bindings.mjs'

export function openJournal(identity) {
  const shortId = identity.anvil.instanceId.slice(2,14)
  const path = journalDir+'/deployment-'+shortId+'.json'
  mkdirSync('.research',{recursive:true})
  // SQLite releases this lock even if the deploy process exits between submission and receipt.
  const lock = new DatabaseSync('.research/session8-local-deployer.sqlite')
  lock.exec('BEGIN IMMEDIATE')
  const state = existsSync(path) ? readJson(path) : {schemaVersion:1,chainId:31337,sender:account0,identity,steps:{}}
  assert.deepEqual(state.identity,identity,'Existing deployment journal belongs to another instance or source')
  const wallet = createWalletClient({chain,account:account0,transport:http(rpcUrl,{retryCount:0})})
  const save = () => writeJson(path,state)

  async function send(label, to, data) {
    const digest = keccak256(data)
    let step = state.steps[label]
    if (step) {
      assert.equal(step.to,to ?? null,'Destination changed for '+label)
      assert.equal(step.dataHash,digest,'Intent changed for '+label)
    } else {
      const latest = await client.getTransactionCount({address:account0})
      assert.equal(await client.getTransactionCount({address:account0,blockTag:'pending'}),latest,'Local deployer has a pending transaction')
      const gas = gasWithHeadroom(await client.estimateGas({account:account0,to,data,value:0n}))
      const gasPrice = await client.getGasPrice()
      const signed = await wallet.signTransaction({chain,account:account0,to,data,value:0n,gas,gasPrice,type:'legacy',nonce:latest})
      const hash = keccak256(signed)
      step = {to:to ?? null,dataHash:digest,nonce:latest,hash,gasLimit:String(gas),gasPrice:String(gasPrice)}
      state.steps[label] = step
      save()
      try {
        assert.equal(await wallet.sendRawTransaction({serializedTransaction:signed}),hash)
      } catch (error) {
        // A lost response can be reconciled safely by reading this exact mined hash.
        const recorded = await client.getTransaction({hash}).catch(()=>null)
        if (!recorded) throw Error('Unconfirmed journaled send for '+label+' ('+hash+')', {cause:error})
      }
    }
    let receipt = await client.getTransactionReceipt({hash:step.hash}).catch(()=>null)
    if (!receipt) {
      const known = await client.getTransaction({hash:step.hash}).catch(()=>null)
      if (!known) {
        // Only re-submit identical signed bytes when the previously reserved nonce is still unused.
        const nonce = await client.getTransactionCount({address:account0,blockTag:'pending'})
        assert.equal(nonce,step.nonce,'Unknown prior send and its nonce is in use: '+label)
        const signed = await wallet.signTransaction({chain,account:account0,to,data,value:0n,
          type:'legacy',gas:BigInt(step.gasLimit),gasPrice:BigInt(step.gasPrice),nonce})
        assert.equal(keccak256(signed),step.hash,'Signer did not reproduce the reserved hash')
        assert.equal(await wallet.sendRawTransaction({serializedTransaction:signed}),step.hash)
      }
      receipt = await client.waitForTransactionReceipt({hash:step.hash,timeout:15_000})
    }
    const tx = await client.getTransaction({hash:step.hash})
    sameAddress(tx.from,account0)
    assert.equal(tx.to?.toLowerCase() ?? null,to?.toLowerCase() ?? null)
    assert.equal(tx.value,0n)
    assert.equal(tx.nonce,step.nonce)
    assert.equal(keccak256(tx.input),digest)
    assert.equal((await client.getBlock({blockNumber:receipt.blockNumber})).hash,receipt.blockHash)
    assert.equal(receipt.status,'success',label+' reverted')
    if (step.blockHash) assert.equal(receipt.blockHash,step.blockHash)
    Object.assign(step,{block:String(receipt.blockNumber),blockHash:receipt.blockHash,gasUsed:String(receipt.gasUsed),status:receipt.status})
    if (receipt.contractAddress) step.contractAddress=receipt.contractAddress
    save()
    return receipt
  }
  return {state,path,send,close:()=>lock.close()}
}
