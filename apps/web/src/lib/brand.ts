/** Product naming per DECISIONS D11. Copy only: no route, contract or package is named after these. */
export const BRAND = {
  name: "Peridot Sentinel",
  wordmark: "sentinel.",
  byline: "By Peridot",
  tagline: "Your money. Your rules. Your intelligence.",
  positioning: "The Financial Operating System for the Agent Economy.",
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
