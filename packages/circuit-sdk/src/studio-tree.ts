import { compilePolicy } from './compiler.js'
import { hashNetlist, type Hex, type PolicySpec } from './spec.js'

export const MAX_LTV_BPS = 10_000
export const SHARD_WIDTH = 128
export const SHARD_COUNT = Math.ceil((MAX_LTV_BPS + 1) * 2 / SHARD_WIDTH)
export const UPPER_WIDTH = 256
export const EMPTY: Hex = `0x${'00'.repeat(32)}`

export function marketSpec(maxLtvBps: number, requireCashReserve: boolean): Extract<PolicySpec, {kind: 'MARKET'}> {
  return {schema: 'peridot.policy/v1', kind: 'MARKET', templateId: 'market-max-ltv-v0', templateVersion: 0,
    params: {maxLtvBps, requireCashReserve}}
}

export function marketLeaf(maxLtvBps: number, reserve: boolean, configHash: Hex, netlistHash: Hex): Hex {
  // Same byte sequence as Solidity abi.encodePacked(uint16, bool, bytes32, bytes32).
  const bps = maxLtvBps.toString(16).padStart(4, '0')
  return hashNetlist(`0x${bps}${reserve ? '01' : '00'}${configHash.slice(2)}${netlistHash.slice(2)}`)
}

export function shardLeaves(shard: number): Hex[] {
  return Array.from({length: SHARD_WIDTH}, (_, i) => {
    const index = shard * SHARD_WIDTH + i
    const bps = Math.floor(index / 2)
    if (bps > MAX_LTV_BPS) return EMPTY
    const reserve = (index & 1) === 1
    const compiled = compilePolicy(marketSpec(bps, reserve))
    return marketLeaf(bps, reserve, compiled.configHash, compiled.netlistHash)
  })
}

// Leaves are position-bound. A node hashes left then right, without sorting.
export function treePath(leaves: readonly Hex[], position = 0): {root: Hex, proof: Hex[]} {
  let level = [...leaves]
  const proof: Hex[] = []
  while (level.length > 1) {
    proof.push(level[position ^ 1])
    const parents: Hex[] = []
    for (let i = 0; i < level.length; i += 2) {
      parents.push(hashNetlist(`0x${level[i].slice(2)}${level[i + 1].slice(2)}`))
    }
    level = parents
    position >>= 1
  }
  return {root: level[0], proof}
}

export function upperLeaves(shards: readonly Hex[]): Hex[] {
  return [...shards, ...Array<Hex>(UPPER_WIDTH - shards.length).fill(EMPTY)]
}
