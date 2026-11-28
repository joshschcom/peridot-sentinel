// Server-side informational quote. The existing MCP entry point and the HTTP reader
// use the same request planner, signing transport and successful quote validation.
import {pathToFileURL} from 'node:url'
import {createProvider, hasCredentials} from './provider.mjs'
import {normalize, pair, quotePlan} from './portfolio-prep/reads.mjs'

export {pair}

export function parseQuoteResult(plan, body, observedAt) {
  try {
    if (plan.kind !== 'quote') throw Error()
    const result = normalize(plan, {httpStatus:200, body, requestedAt:observedAt, receivedAt:observedAt,
      provenance:'provider-response'})
    if (result.status !== 'received') throw Error()
    const {from, to, amountIn, amountOut} = result.data
    return {source:'OKX OnchainOS', chainId:196, tokenIn:pair[from], amountIn, tokenOut:pair[to], amountOut, observedAt}
  } catch {
    throw Error('Quote unavailable or mismatched route')
  }
}

export async function quote(from, amount, {env=process.env, request=fetch, now=Date.now}={}) {
  let plan
  try { plan = quotePlan(from, amount) } catch { throw Error('Expected WOKB or USDC and a positive raw token amount') }
  if (!hasCredentials(env)) throw Error('OnchainOS credentials unavailable')
  const observedAt = new Date(now()).toISOString()
  const response = await createProvider({env, fetch:request, now}).read(plan)
  if (response.status !== 'ok') throw Error('Quote service unavailable')
  return parseQuoteResult(plan, response.body, observedAt)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { console.log(JSON.stringify(await quote(process.argv[2], process.argv[3]))) }
  catch (e) { console.error(e.message); process.exitCode = 1 }
}
