// Public 1952 uses two RPC witnesses; the fork branch accepts only the dedicated local node.
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {existsSync,mkdirSync,readFileSync} from 'node:fs'
import {DatabaseSync} from 'node:sqlite'
import {Journal} from '../mcp/journal.mjs'
import {createPublicClient,createWalletClient,defineChain,encodeFunctionData,getAddress,http,parseAbi,keccak256,toHex} from 'viem'
import {privateKeyToAccount} from 'viem/accounts'
import {deployer,operator,publicRpc,readJson,retryRead,writeJson,gasWithHeadroom} from '../../contracts/expansion/script/session6-transactions.mjs'

export {deployer,operator,readJson,retryRead,writeJson}
export const sha256File = path => createHash('sha256').update(readFileSync(path)).digest('hex')
export const wad=10n**18n, usd=10n**6n
export const base=readJson('packages/chain-config/deployments/1952.json')
export const expansion=readJson('packages/chain-config/expansion/deployments/1952.json')
export const fixtureJudge=privateKeyToAccount(keccak256(toHex('Peridot Session 7 fork-only judge'))).address
export const localRpc='http://127.0.0.1:19750'
const registryOwner=getAddress(deployer)
const d9=getAddress(operator)
const maxGasPrice=1_000_000_000n
const budgets={deployer:40_000_000_000_000_000n,owner:10_000_000_000_000_000n,operator:1_000_000_000_000_000n}
const maxFunding=15_000_000_000_000_000n
const operatorAbi=parseAbi(['function autoRepay()','function swapExactIn(address,uint256,uint256,uint64)','function borrow(uint256)'])
export function guardOperatorIntent(manifest,phase,to,input,value,expected,gas) {
  const v2=getAddress(manifest.contracts.account),v1=getAddress(manifest.markets.A.account)
  assert.equal(value,0n)
  const actions={
    repay:{target:v1,fn:'autoRepay',args:[]},
    swap:{target:v2,fn:'swapExactIn',args:[manifest.contracts.mockWokb,wad/4n,19_800_000n,BigInt(manifest.grants.swap.expiry)]},
    'deny-operator':{target:v2,fn:'borrow',args:[1n]},
  }
  const action=actions[phase]
  assert(action && to && getAddress(to)===action.target,'Operator destination mismatch')
  assert.equal(input,encodeFunctionData({abi:operatorAbi,functionName:action.fn,args:action.args}),'Operator calldata mismatch')
  assert.equal(expected,phase==='deny-operator'?'reverted':'success')
  assert.equal(gas,phase==='deny-operator'?300_000n:undefined)
}

export async function open(mode,campaign,phase) {
  assert(['fork','testnet'].includes(mode) && /^[a-z][a-z0-9-]{0,39}$/.test(campaign),'Use fork|testnet and a simple campaign name')
  const live=mode==='testnet'
  const owner=getAddress(live?process.env.JUDGE_OWNER:process.env.JUDGE_OWNER??fixtureJudge)
  assert(owner!==registryOwner && owner!==d9 && BigInt(owner)!==0n && (!live || owner!==fixtureJudge),'Supply a distinct fresh judge address')
  const actors={deployer:registryOwner,owner,operator:d9}
  if(live){
    const roles={fund:['deployer'],setup:['deployer','owner'],refresh:['deployer'],'policy-denials':['owner'],revoke:['owner'],verify:[],swap:['operator'],repay:['operator'],'deny-operator':['operator']}
    for(const role of roles[phase]){
      const env={deployer:'PERIDOT_TESTNET_KEY',owner:'JUDGE_OWNER_KEY',operator:'SENTINEL_OPERATOR_KEY'}[role]
      const key=(process.env[env]??'').trim().replace(/^0x/,'')
      assert(/^[0-9a-f]{64}$/i.test(key),'Missing dedicated '+role+' signer environment')
      assert.equal(privateKeyToAccount('0x'+key).address,actors[role],'Wrong '+role+' signer')
    }
  }
  const url=live?publicRpc:localRpc
  const chain=defineChain({id:1952,name:'X Layer testnet',nativeCurrency:{name:'OKB',symbol:'OKB',decimals:18},rpcUrls:{default:{http:[url]}}})
  const clientAt=address=>createPublicClient({chain,cacheTime:0,transport:http(address,{retryCount:0,timeout:15000})})
  const client=clientAt(url),witness=live?clientAt('https://xlayertestrpc.okx.com'):client
  const wallet=createWalletClient({chain,transport:http(url,{retryCount:0})})
  let instance='1952'
  for(const c of new Set([client,witness])) {
    assert.equal(await retryRead(()=>c.getChainId()),1952)
    const m4=readJson('evidence/testnet/keeper-auto-repay-1952.json')
    const anchored=await retryRead(()=>c.getTransactionReceipt({hash:m4.txHash}))
    assert.equal(anchored.blockNumber,BigInt(m4.block))
    assert.equal(anchored.status,'success')
  }
  if(!live){
    const info=await client.request({method:'anvil_nodeInfo'})
    assert.equal(info.forkConfig.forkUrl,publicRpc)
    const meta=await client.request({method:'anvil_metadata'})
    instance='fork-'+meta.instanceId.slice(2,18)
    for(const actor of Object.values(actors)) await client.request({method:'anvil_impersonateAccount',params:[actor]})
  }
  const dir='deployments/session7/'+instance+'/'+campaign
  mkdirSync(dir,{recursive:true})
  const path=dir+'/journal.json'
  const localState='services/judge-demo/.state/'+instance
  mkdirSync(localState,{recursive:true,mode:0o700})
  const lock=new DatabaseSync(localState+'/judge-writers.sqlite')
  lock.exec('BEGIN IMMEDIATE')
  const lane=live && ['swap','repay','deny-operator'].includes(phase) ? new Journal(localState+'/d9.sqlite',
    'services/keeper/.state/1952/'+getAddress(base.contracts.SentinelAccountFactory)+'/'+d9+'/operator.sqlite') : null
  const close=()=>{lane?.close();lock.close()}
  try {
    const profile=live?'public-testnet':'private-testnet-fork'
    const state=existsSync(path)?readJson(path):{schemaVersion:1,chainId:1952,campaign,profile,actors,steps:{},plan:{}}
    assert.deepEqual(state.actors,actors,'This campaign already belongs to another judge')
    assert.equal(state.profile,profile)
    const save=()=>writeJson(path,state)
    const minHeight=()=>Object.values(state.steps).reduce((n,s)=>s.blockNumber && BigInt(s.blockNumber)>n?BigInt(s.blockNumber):n,0n)
    const head=()=>retryRead(()=>client.getBlock(),b=>b.number>=minHeight())
    const view=(address,abi,functionName,args=[],blockNumber)=>retryRead(()=>client.readContract({address,abi,functionName,args,blockNumber}))
    const balance=(actor,blockNumber)=>retryRead(()=>client.getBalance({address:actor,blockNumber}))
    async function send(label,role,to,data='0x',options={}) {
      const {value=0n,gas,expected='success'}=options
      assert(Object.hasOwn(actors,role))
      assert.equal(role==='operator',['repay','swap','deny-operator'].includes(phase),'Operator and owner phases run separately')
      if(role==='operator'){
        assert.equal(label,phase)
        const reviewed=readJson(dir+'/manifest.json')
        assert(reviewed.profile===profile && reviewed.chainId===1952 && reviewed.campaign===campaign && getAddress(reviewed.owner)===owner)
        guardOperatorIntent(reviewed,phase,to,data,value,expected,gas)
      }
      if(expected==='reverted') assert(gas>0n)
      if(value>0n) assert(role==='deployer' && ['fund-judge','fund-operator'].includes(label) &&
        to===actors[label==='fund-judge'?'owner':'operator'] && value<=maxFunding && data==='0x')
      const account=actors[role]
      const intent={role,account,to:to?getAddress(to):null,dataHash:keccak256(data),value:String(value),expected}
      const reservation=campaign+'/'+label
      const savedLane=lane?.get(reservation)
      let step=state.steps[label]
      if(!step && savedLane?.hash){
        step=JSON.parse(savedLane.body)
        assert.equal(step.hash,savedLane.hash)
        state.steps[label]=step;save()
      }
      if(step) assert.deepEqual(step.intent,intent,'Journaled intention changed: '+label)
      else {
        const nonce=await retryRead(async()=>{
          const readCount=(c,blockTag)=>c.getTransactionCount({address:account,blockTag})
          const [pending,current,seen]=await Promise.all([readCount(client,'pending'),readCount(client,'latest'),readCount(witness,'latest')])
          assert.equal(pending,current,'Wait for pending signer transaction')
          assert.equal(current,seen,'Nonce witnesses disagree')
          const owned=Object.values(state.steps).filter(s=>s.intent.role===role)
          assert(owned.every(s=>s.blockNumber && s.nonce<current),'Earlier reserved signer nonce requires reconciliation')
          return current
        })
        const limit=gas??gasWithHeadroom(await retryRead(()=>client.estimateGas({account,to,data,value})))
        const gasPrice=live?await retryRead(()=>client.getGasPrice()):((await head()).baseFeePerGas??20_000_000n)*2n+1n
        assert(gasPrice>0n && gasPrice<=maxGasPrice && limit*gasPrice<=budgets[role] && limit*gasPrice+value<=await balance(account),'Fee ceiling or signer balance')
        // Campaign-wide gas ceilings bound cumulative cost even when many creations are needed.
        const used=Object.values(state.steps).filter(s=>s.intent.role===role).reduce((n,s)=>n+BigInt(s.gasUsed)*BigInt(s.gasPrice),0n)
        assert(used+limit*gasPrice<=budgets[role],'Campaign signer fee ceiling')
        const tx={chainId:1952,type:'legacy',nonce,to,data,value,gas:limit,gasPrice}
        step={intent,nonce,gasLimit:String(limit),gasPrice:String(gasPrice)}
        if(live) {
          const env={deployer:'PERIDOT_TESTNET_KEY',owner:'JUDGE_OWNER_KEY',operator:'SENTINEL_OPERATOR_KEY'}[role]
          const key=(process.env[env]??'').trim().replace(/^0x/,'')
          assert(/^[a-f0-9]{64}$/i.test(key),'Missing dedicated '+role+' signer environment')
          const signer=privateKeyToAccount('0x'+key)
          assert.equal(signer.address,account,'Wrong '+role+' signer')
          const signed=await signer.signTransaction(tx)
          step.hash=keccak256(signed)
          if(lane){
            // A busy keeper can leave an unsigned proposal whose nonce/fee changes on retry.
            // The durable row and pending slot still reserve the exact signed hash before broadcast.
            lane.db.prepare('DELETE FROM proposal WHERE id=? AND hash IS NULL').run(reservation)
            lane.propose(reservation,step)
            assert(lane.reserve(reservation,step.hash,nonce,to),'D9 reservation already exists')
          }
          state.steps[label]=step;save()
          try{assert.equal(await wallet.sendRawTransaction({serializedTransaction:signed}),step.hash)}
          catch{console.error('Reading the previously reserved transaction',step.hash)}
        } else {
          state.steps[label]=step;save()
          step.hash=await wallet.sendTransaction({...tx,account,chain});save()
        }
      }
      assert(step.hash,'Unknown fork transaction: reconcile the reserved nonce manually')
      const receipt=await retryRead(async()=>{
        const [r,other,t]=await Promise.all([client.getTransactionReceipt({hash:step.hash}),witness.getTransactionReceipt({hash:step.hash}),client.getTransaction({hash:step.hash})])
        const [b,depth]=await Promise.all([client.getBlock({blockNumber:r.blockNumber}),witness.getBlockNumber()])
        assert.equal(r.blockHash,b.hash);assert.equal(other.blockHash,b.hash)
        assert.equal(getAddress(t.from),account);assert.equal(t.nonce,step.nonce)
        assert.equal(t.to?getAddress(t.to):null,intent.to);assert.equal(keccak256(t.input),intent.dataHash);assert.equal(t.value,value)
        assert(depth>=r.blockNumber+(live?2n:0n))
        return r
      })
      Object.assign(step,{blockNumber:String(receipt.blockNumber),blockHash:receipt.blockHash,gasUsed:String(receipt.gasUsed),status:receipt.status});save()
      lane?.settle(reservation,step.hash,{status:receipt.status,blockNumber:String(receipt.blockNumber)})
      assert.equal(receipt.status,expected,label+' produced unexpected receipt '+step.hash)
      console.error(label,step.hash,receipt.status)
      return receipt
    }
    return {client,witness,actors,profile,dir,campaign,phase,state,save,head,view,balance,send,close,live}
  } catch(e) {close();throw e}
}
