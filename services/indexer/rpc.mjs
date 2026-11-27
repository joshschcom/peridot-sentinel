import assert from 'node:assert/strict'
import {HistoryUnavailable} from './history.mjs'

export function reader(url) {
  let id = 0
  return async (method,params) => {
    let last
    let allHistorical=true
    for (let attempt=0; attempt<4; attempt++) {
      try {
        const n = ++id
        const res = await fetch(url,{method:'POST',headers:{'content-type':'application/json'},
          body:JSON.stringify({jsonrpc:'2.0',id:n,method,params}),signal:AbortSignal.timeout(10000)})
        if (!res.ok) throw Error('HTTP '+res.status)
        const body = await res.json()
        assert(body.id===n && body.jsonrpc==='2.0','Incomplete RPC reply')
        const historical=(method==='eth_getBlockByNumber' && /^0x[0-9a-f]+$/i.test(params[0])) || method==='eth_getLogs'
        if (body.error) {
          if (historical && /pruned|history (?:is )?unavailable|historical (?:data|logs|blocks?) (?:not available|unavailable)|(?:block|header) (?:is )?not found|missing trie node/i.test(body.error.message)) {
            throw new HistoryUnavailable(body.error.message)
          }
          throw Error(body.error.message)
        }
        if (historical && method==='eth_getBlockByNumber' && body.result===null) throw new HistoryUnavailable('Historical block not found')
        assert(body.result!=null,'Incomplete RPC reply')
        return body.result
      } catch(error) {
        last=error
        if (!(error instanceof HistoryUnavailable)) allHistorical=false
        if (attempt<3) await new Promise(resolve=>setTimeout(resolve,250*2**attempt))
      }
    }
    const message=url+' '+method+' failed: '+last.message
    if (allHistorical) throw new HistoryUnavailable(message)
    throw Error(message)
  }
}

