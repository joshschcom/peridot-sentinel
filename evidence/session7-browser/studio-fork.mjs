// Test-only judge browser. Sends through an unlocked wallet on a verified private 1952 Anvil fork.
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { chromium } from 'playwright'
import { createPublicClient, getAddress, http, parseEventLogs } from 'viem'
import { MarketFactoryAbi } from '@peridot/chain-config'
import { installTestWallet, connectWallet } from '../../apps/web/scripts/lib/test-wallet.mjs'
import { readJson, writeJson } from '../../contracts/expansion/script/session6-transactions.mjs'

const rpcUrl = 'http://127.0.0.1:19750'
const chain = createPublicClient({transport: http(rpcUrl), cacheTime: 0})
assert.equal(await chain.getChainId(), 1952)
const info = await chain.request({method:'anvil_nodeInfo'})
assert.equal(info.forkConfig.forkUrl, 'https://testrpc.xlayer.tech')
const {instanceId} = await chain.request({method:'anvil_metadata'})
const dir = resolve('deployments/session7/fork-' + instanceId.slice(2,18), 'studio-join')
const j = readJson(dir + '/journal.json')
const owner = getAddress(j.actors.owner)
const factory = readJson('packages/chain-config/deployments/1952.json').contracts.MarketFactory
const proofPath = 'evidence/session7-browser/creation.json'
if (existsSync(proofPath)) {
  const prior = readJson(proofPath)
  assert(prior.instanceId === instanceId && getAddress(prior.owner) === owner, 'Prior browser evidence belongs to another private chain')
  const mined = await chain.getTransactionReceipt({hash: prior.transactions.at(-1).hash})
  assert.equal(mined.blockHash, prior.transactions.at(-1).blockHash)
  console.log('Reusing previously observed Studio browser receipt', mined.transactionHash)
  process.exit(0)
}
// Prevent a duplicate market if the previous browser closed between mining and reporting.
const count = await chain.readContract({address:factory, abi:MarketFactoryAbi,functionName:'marketCount'})
for (let i=0n; i<count; i++) {
  const controller = await chain.readContract({address:factory, abi:MarketFactoryAbi, functionName:'marketAt',args:[i]})
  const marketOwner = await chain.readContract({address:controller,abi:[{type:'function',name:'owner',stateMutability:'view',inputs:[],outputs:[{type:'address'}]}],functionName:'owner'})
  assert(getAddress(marketOwner) !== owner, 'Judge already created a market. Reconcile the fork receipt before any further browser submission.')
}
const browser = await chromium.launch()
try {
  const context = await browser.newContext({viewport:{width:1280,height:990},reducedMotion:'reduce'})
  await context.route(/^https?:\/\/([^/]*\.)?(xlayer\.tech|okx\.com)(\/|$)/, async route => {
    if (route.request().method() !== 'POST') return route.abort()
    // Forward the browser's incidental public read transport to the same disposable chain.
    const body = route.request().postDataJSON()
    assert((Array.isArray(body) ? body : [body]).every(q => /^(eth_(call|blockNumber|chainId|get[A-Z].*|estimateGas|gasPrice|feeHistory|maxPriorityFeePerGas)|net_version)$/.test(q.method)))
    const response = await route.fetch({url:rpcUrl,method:'POST',data:body})
    await route.fulfill({response})
  })
  const {sent} = await installTestWallet(context,{rpcUrl,account:owner,walletChainId:'0x7a0'})
  const page = await context.newPage()
  const ui = process.env.JUDGE_BROWSER_ORIGIN ?? 'http://127.0.0.1:3220'
  assert(/^http:\/\/127\.0\.0\.1:\d+$/.test(ui))
  await page.goto(ui + '/studio/create', {waitUntil:'networkidle', timeout:90000})
  await connectWallet(page)
  await page.getByLabel('Collateral supply cap').fill('1000')
  await page.getByLabel('Lending supply cap').fill('1000')
  await page.getByLabel('Borrow cap',{exact:true}).fill('900')
  await page.getByLabel('Cash reserve').fill('10')
  const next = page.getByTestId('wizard-next')
  await next.click()
  await page.getByRole('radio',{name:/Custom/}).click()
  await page.locator('#cap').fill(String(j.plan.caps.A))
  await page.locator('#borrow').fill('7500')
  await page.locator('#liq').fill('8500')
  await next.click()
  await page.getByText('Roots match',{exact:true}).waitFor()
  await next.click()
  await page.getByTestId('create-market').click()
  await page.getByTestId('open-created-market').waitFor({timeout:90000})
  const transactions = []
  for (const tx of sent) {
    const receipt = await chain.getTransactionReceipt({hash:tx.hash})
    assert.equal(receipt.status,'success')
    assert.equal(getAddress(receipt.from),owner)
    transactions.push({...tx,block:String(receipt.blockNumber),blockHash:receipt.blockHash})
  }
  assert.equal(transactions.length,3)
  const creation = await chain.getTransactionReceipt({hash:transactions.at(-1).hash})
  assert.equal(getAddress(creation.to),getAddress(factory))
  const [created] = parseEventLogs({abi:MarketFactoryAbi,eventName:'MarketCreated',logs:creation.logs})
  assert.equal(getAddress(created.args.owner),owner)
  const target = await page.getByTestId('open-created-market').getAttribute('href')
  assert.equal(target.toLowerCase(),'/studio/'+created.args.controller.toLowerCase())
  await page.screenshot({path:'evidence/session7-browser/studio-fork.png',fullPage:true})
  writeJson(proofPath,{instanceId,label:'Browser Studio wallet, private fork of public X Layer testnet, chain ID 1952',forkBlock:String(BigInt(info.forkConfig.forkBlockNumber)),campaign:'studio-join',owner,capBps:j.plan.caps.A,transactions,event:created.args,uiLink:target})
  console.log('Fork Studio creation',creation.transactionHash,target)
} finally { await browser.close() }
