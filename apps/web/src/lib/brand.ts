/** Product naming per DECISIONS D11. Copy only: no route, contract or package is named after these. */
export const BRAND = {
  name: "Peridot Sentinel",
  wordmark: "sentinel.",
  byline: "By Peridot",
  tagline: "Your money. Your rules. Your intelligence.",
  /** Strategy-first positioning (DECISIONS D23). The tagline above is unchanged. */
  positioning: "Your automated DeFi portfolio",
  headline: "Put your portfolio on autopilot.",
  supporting: "Discover investment strategies, connect your own AI or create financial products for others. You define the rules. Sentinel enforces them.",
} as const;

/**
 * How far along a product area is. Used by the navigation and the Automate modes so that nothing is advertised
 * beyond what this build can do:
 *   live         works against the deployed contracts in this build;
 *   development  being built now; visible, labelled, not usable yet;
 *   planned      on the roadmap; no code path in this build.
 */
export type Availability = "live" | "development" | "planned";
export const AVAILABILITY_LABEL: Record<Availability, string> = { live: "Live", development: "In development", planned: "Planned" };
