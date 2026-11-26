// Public read-only check. These addresses identify the existing M4 and base v2 demonstration.
import {createPublicClient,fallback,http,decodeFunctionData} from 'viem'
import {SentinelAccountAbi} from '@peridot/chain-config'
import v2Abi from '../chain-config/expansion/abi/SentinelAccountV2.json' with {type:'json'}
import {buildAdoptionPlan,buildRevocationPlan,curatedStrategies} from './index.ts'
const client = createPublicClient({transport:fallback(['https://testrpc.xlayer.tech','https://xlayertestrpc.okx.com'].map(url=>http(url,{retryCount:1,timeout:10000})))})
const selection = {owner:'0x8C1741a53d5FB97D74C1d105b0fbFbb4740d5D67',operator:'0x2c7E78e47deBC84eFac28D336f98d54b4c1FCE88'}
for(const {template} of curatedStrategies()) {
  const preview=await buildAdoptionPlan(client,template,selection)
  const ready=preview.reviewId ? await buildAdoptionPlan(client,template,{...selection,acknowledge:preview.reviewId}) : preview
  const stop=await buildRevocationPlan(client,template,selection)
  if(!ready.transactions.length) throw Error('State changed during review')
  const abi=template.profile==='debt-protection-v1'?SentinelAccountAbi:v2Abi
  const methods=[...ready.transactions,...stop.transactions].map(tx=>decodeFunctionData({abi,data:tx.data}).functionName)
  console.log(JSON.stringify({profile:template.profile,chainId:ready.chainId,account:ready.account,block:ready.blockNumber.toString(),hash:ready.blockHash,
    previousGrant:ready.currentGrant,previousTrigger:ready.currentTrigger,replacementReview:!!ready.reviewId,methods}))
}
