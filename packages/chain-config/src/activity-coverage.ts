/** Shared and judge activity snapshots, schema version 1. All segment endpoints are inclusive. */
export interface ActivitySegment {
  fromBlock: string;
  toBlock: string;
  fromBlockHash?: string;
  toBlockHash: string;
  sourceCoverage: 'configured' | 'known-emitters';
}

export interface ActivityCoverage {
  fromBlock: string;
  toBlock: string;
  toBlockHash: string;
  gaps: readonly {fromBlock: string; toBlock: string; reason: string}[];
  segments?: readonly ActivitySegment[];
}

const hash = /^0x[0-9a-f]{64}$/i;
const height = (value: string) => {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]*)$/.test(value)) throw Error('Invalid activity block height');
  return BigInt(value);
};

/**
 * Pass the observed hash at coverage.toBlock, or null when the RPC cannot read it.
 * Rows remain historical evidence in every state. Only a matching terminal segment
 * can join a separately verified live scan; earlier segments keep their own provenance.
 */
export function activityCoverageView(coverage: ActivityCoverage, observedTerminalHash: string | null) {
  if (!hash.test(coverage.toBlockHash) || (observedTerminalHash !== null && !hash.test(observedTerminalHash))) {
    throw Error('Invalid activity checkpoint hash');
  }
  const end = height(coverage.toBlock);
  for (const gap of coverage.gaps) {
    const from = height(gap.fromBlock);
    if (height(gap.toBlock) < from || (from <= end && gap.reason !== 'history-unavailable')) {
      throw Error('Unrecognized or invalid gap within recorded coverage');
    }
  }
  const segments = coverage.segments ?? [{
    fromBlock: coverage.fromBlock, toBlock: coverage.toBlock, toBlockHash: coverage.toBlockHash,
    sourceCoverage: 'configured' as const,
  }];
  const gaps = coverage.gaps.filter(gap => gap.reason === 'history-unavailable');
  if (!segments.length || segments.length !== gaps.length + 1) throw Error('Activity segments and history gaps disagree');
  let previousEnd = height(coverage.fromBlock) - 1n;
  for (const [index, segment] of segments.entries()) {
    const from = height(segment.fromBlock);
    const to = height(segment.toBlock);
    if (to < from || !hash.test(segment.toBlockHash) ||
        (segment.sourceCoverage !== 'configured' && segment.sourceCoverage !== 'known-emitters') ||
        (segment.fromBlockHash !== undefined && !hash.test(segment.fromBlockHash))) throw Error('Invalid activity segment');
    if (index === 0) {
      if (from !== previousEnd + 1n) throw Error('Activity coverage start does not match first segment');
    } else {
      const gap = gaps[index - 1];
      if (!segment.fromBlockHash || from <= previousEnd + 1n ||
          height(gap.fromBlock) !== previousEnd + 1n || height(gap.toBlock) !== from - 1n) {
        throw Error('Missing or inconsistent activity recovery anchor');
      }
    }
    previousEnd = to;
  }
  const tail = segments[segments.length - 1];
  if (tail.toBlock !== coverage.toBlock || tail.toBlockHash.toLowerCase() !== coverage.toBlockHash.toLowerCase()) {
    throw Error('Activity coverage end does not match terminal segment');
  }
  const checkpoint = observedTerminalHash === null ? 'unavailable' as const
    : observedTerminalHash.toLowerCase() === tail.toBlockHash.toLowerCase() ? 'matches' as const : 'conflict' as const;
  return { historicalSegments: segments, gaps: coverage.gaps, checkpoint, mergeableTail: checkpoint === 'matches' ? tail : null };
}
