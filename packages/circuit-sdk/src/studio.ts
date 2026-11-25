import { compilePolicy } from './compiler.js'
import { MARKET_SHARDS, STUDIO_MARKET_ROOT } from './studio-roots.js'
import { SHARD_WIDTH, marketSpec, shardLeaves, treePath, upperLeaves } from './studio-tree.js'

export { STUDIO_MARKET_ROOT } from './studio-roots.js'
export { MAX_LTV_BPS as STUDIO_MAX_LTV_BPS } from './studio-tree.js'

/** One integer bps threshold (0..10000) and reserve switch. Safe to run locally in the browser. */
export function studioMarketTemplate(maxLtvBps: number, requireCashReserve: boolean) {
  const spec = marketSpec(maxLtvBps, requireCashReserve)
  const compiled = compilePolicy(spec)
  const index = maxLtvBps * 2 + Number(requireCashReserve)
  const shard = Math.floor(index / SHARD_WIDTH)
  const lower = treePath(shardLeaves(shard), index % SHARD_WIDTH)
  const upper = treePath(upperLeaves(MARKET_SHARDS), shard)
  if (lower.root !== MARKET_SHARDS[shard] || upper.root !== STUDIO_MARKET_ROOT) {
    throw new Error('Circuit compiler and Studio commitment version differ')
  }
  return {spec, compiled, proof: [...lower.proof, ...upper.proof]}
}
