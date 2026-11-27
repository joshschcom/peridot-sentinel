// The six disclosures every commercially worded surface must still carry (DECISIONS D24): the network, test tokens,
// mock feeds and venues, the development reference processor, "not an audit", and owner-only withdrawal.
// The short line must be VISIBLE without opening anything; the one-sentence explanations sit behind it.
export const DISCLOSURE_SURFACES = ["/", "/discover", "/strategies", "/connect"];
export const hasDisclosures = (path) => DISCLOSURE_SURFACES.includes(path.replace(/[?#].*$/, ""));

const LINE = [
  ["network", /X Layer testnet|Local development chain/],
  ["test tokens", /Test tokens, no value/],
  ["mock feeds and venues", /Mock price feeds and venues/],
  ["development reference processor", /Development reference processor/],
  ["not audited", /Not audited/],
  ["owner-only withdrawal", /Only the owner can withdraw/],
];
const DETAIL = [
  ["no mainnet deployment (or the local chain)", /Nothing here is a mainnet deployment|local development chain/],
  ["tokens without value", /test token without value/],
  ["mock feed, mock venue, mock vault", /mock feed.*mock venue.*vault is a mock/],
  ["not TapeOut", /development reference processor on this network, not by TapeOut/],
  ["not an audit", /they are not an audit, and none has been performed/],
  ["owner-only withdrawal", /Owner-only withdrawal: an operator or an AI .* can never move funds out/],
];

/** Returns the list of what is missing on this page. Empty: all six are there, and the line is visible. */
export async function disclosureProblems(page) {
  const found = await page.evaluate(() => {
    const box = document.querySelector('[data-testid="disclosures"]');
    if (!box) return null;
    const summary = box.querySelector("summary");
    const rect = summary.getBoundingClientRect();
    return { line: summary.innerText.replace(/\s+/g, " "), detail: box.querySelector('[data-testid="disclosure-details"]').textContent.replace(/\s+/g, " "), visible: rect.width > 0 && rect.height > 0 && getComputedStyle(summary).visibility !== "hidden", count: document.querySelectorAll('[data-testid="disclosures"]').length };
  });
  if (!found) return ["no disclosure line on the page"];
  const problems = [];
  if (!found.visible) problems.push("the disclosure line is not visible");
  for (const [name, pattern] of LINE) if (!pattern.test(found.line)) problems.push(`the line lacks "${name}"`);
  for (const [name, pattern] of DETAIL) if (!pattern.test(found.detail)) problems.push(`the explanation lacks "${name}"`);
  return problems;
}
