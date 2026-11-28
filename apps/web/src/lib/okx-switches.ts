/**
 * The committed switches of everything this app shows from OKX Onchain OS (DECISIONS D25): the "Other networks"
 * section of Portfolio, per network, and the indicative mainnet quote on Trade.
 *
 * Rules:
 *   - Every switch is OFF in this file until an authenticated observation on the deployed app has been verified for
 *     that network and cross-checked against an independent RPC. Turning one on is a reviewed commit, nothing else.
 *   - An environment variable can only turn them OFF (NEXT_PUBLIC_PERIDOT_OTHER_NETWORKS=off, all at once). Nothing
 *     can force one on: not a variable, not a URL, not example-data mode.
 *   - The switches only decide what the pages show. The two server routes (api/onchainos) exist either way and never
 *     depend on this file.
 *
 * Pure, so it runs in node tests and can be imported by the check scripts.
 */
export const OKX_CHAIN_INDEXES = ["196", "1", "8453", "501"] as const;
export type OkxChainIndex = (typeof OKX_CHAIN_INDEXES)[number];

export interface OkxSwitches {
  /** Per OKX chain index: is this network's wallet lookup offered on Portfolio? */
  portfolio: Record<OkxChainIndex, boolean>;
  /** The indicative 1 WOKB → USDC price of X Layer mainnet on Trade. */
  quote: boolean;
}

const COMMITTED: OkxSwitches = {
  portfolio: { "196": false, "1": false, "8453": false, "501": false },
  quote: false,
};

export function okxSwitches(override: string | undefined, committed: OkxSwitches = COMMITTED): OkxSwitches {
  const off = override === "off";
  return {
    portfolio: Object.fromEntries(OKX_CHAIN_INDEXES.map((chainIndex) => [chainIndex, committed.portfolio[chainIndex] === true && !off])) as Record<OkxChainIndex, boolean>,
    quote: committed.quote === true && !off,
  };
}

export const OKX_SWITCHES = okxSwitches(process.env.NEXT_PUBLIC_PERIDOT_OTHER_NETWORKS);

/** The networks whose lookup is offered, in display order. Empty: the section is one "Planned" line. */
export const enabledNetworks = (switches: OkxSwitches): OkxChainIndex[] => OKX_CHAIN_INDEXES.filter((chainIndex) => switches.portfolio[chainIndex]);
