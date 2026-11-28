/**
 * Where the "Other networks" section and the indicative quote get their answers.
 *
 * The source is a BUILD constant, never something a page or a URL can choose:
 *   - a build pinned to example data (NEXT_PUBLIC_PERIDOT_DATA=fixture) answers from the synthetic scenarios in
 *     src/services/fixture/okx.ts and contains no path to the routes: it cannot send an address anywhere;
 *   - every other build asks the app's own routes (api/onchainos), and only when a component calls these functions.
 *     The components call them on a button press (portfolio) or behind the committed switch (quote).
 *
 * Either way the answer goes through the same checks (src/lib/okx-portfolio.ts) before a component sees it.
 */
import { LOCAL_REASONS, type OkxPortfolioView, type OkxQuoteView, type OkxSubject, portfolioFailure, portfolioFromAnswer, portfolioPath, quoteFailure, quoteFromAnswer, quotePath } from "../lib/okx-portfolio.ts";
import { type OkxFixtureScenario, fixturePortfolio, fixtureQuote } from "./fixture/okx.ts";
import { FORCE_FIXTURE } from "./runtime.ts";

export const OKX_SOURCE: "example" | "route" = FORCE_FIXTURE ? "example" : "route";
/** The scenario an example-data build shows when the URL names none. */
export const DEFAULT_OKX_SCENARIO: OkxFixtureScenario = "mixed";

const settle = () => new Promise((resolve) => setTimeout(resolve, 60));

async function routeAnswer(path: string, signal?: AbortSignal): Promise<{ status: number; body: unknown } | null> {
  try {
    const response = await fetch(path, { method: "GET", cache: "no-store", credentials: "same-origin", headers: { accept: "application/json" }, signal });
    return { status: response.status, body: await response.json().catch(() => null) };
  } catch {
    return null;
  }
}

/** One request for the given subjects. Never called without a user action. */
export async function lookupPortfolio(subjects: readonly OkxSubject[], scenario: OkxFixtureScenario | null, signal?: AbortSignal): Promise<OkxPortfolioView> {
  if (OKX_SOURCE === "example") {
    await settle();
    const answer = fixturePortfolio(scenario ?? DEFAULT_OKX_SCENARIO, subjects, Date.now());
    return portfolioFromAnswer(answer.status, answer.body, subjects);
  }
  const answer = await routeAnswer(portfolioPath(subjects), signal);
  return answer ? portfolioFromAnswer(answer.status, answer.body, subjects) : portfolioFailure(subjects, LOCAL_REASONS.failed);
}

/** The indicative 1 WOKB → USDC price. It names no address. */
export async function readIndicativeQuote(scenario: OkxFixtureScenario | null, signal?: AbortSignal): Promise<OkxQuoteView> {
  if (OKX_SOURCE === "example") {
    await settle();
    const answer = fixtureQuote(scenario ?? DEFAULT_OKX_SCENARIO, Date.now());
    return quoteFromAnswer(answer.status, answer.body);
  }
  const answer = await routeAnswer(quotePath(), signal);
  return answer ? quoteFromAnswer(answer.status, answer.body) : quoteFailure(LOCAL_REASONS.failed);
}
