import assert from "node:assert/strict";
import { test } from "node:test";
import { OKX_CHAIN_INDEXES, OKX_SWITCHES, type OkxSwitches, enabledNetworks, okxSwitches } from "./okx-switches.ts";

const ALL_ON: OkxSwitches = { portfolio: { "196": true, "1": true, "8453": true, "501": true }, quote: true };

test("the committed switches name exactly X Layer 196, Ethereum 1, Base 8453 and Solana 501, and the quote", () => {
  assert.deepEqual([...OKX_CHAIN_INDEXES], ["196", "1", "8453", "501"]);
  assert.deepEqual(Object.keys(okxSwitches(undefined).portfolio).sort(), ["1", "196", "501", "8453"]);
  assert.equal(typeof okxSwitches(undefined).quote, "boolean");
});

test("an environment value can only turn the switches off", () => {
  // Whatever is committed, "off" yields nothing.
  assert.deepEqual(enabledNetworks(okxSwitches("off", ALL_ON)), []);
  assert.equal(okxSwitches("off", ALL_ON).quote, false);
  // No value turns anything on that the committed file has off.
  const committed = okxSwitches(undefined);
  for (const value of [undefined, "", "on", "1", "true", "all", "196", "196,1,8453,501", "quote", "OFF", " off", "force"]) {
    const result = okxSwitches(value);
    for (const chainIndex of OKX_CHAIN_INDEXES) assert.equal(result.portfolio[chainIndex] && !committed.portfolio[chainIndex], false, `"${value}" turned ${chainIndex} on`);
    assert.equal(result.quote && !committed.quote, false, `"${value}" turned the quote on`);
  }
  // A value other than exactly "off" changes nothing.
  assert.deepEqual(okxSwitches("on", ALL_ON), ALL_ON);
});

test("each network has its own switch", () => {
  const one = okxSwitches(undefined, { portfolio: { "196": true, "1": false, "8453": false, "501": false }, quote: false });
  assert.deepEqual(enabledNetworks(one), ["196"]);
  const two = okxSwitches(undefined, { portfolio: { "196": false, "1": true, "8453": false, "501": true }, quote: true });
  assert.deepEqual(enabledNetworks(two), ["1", "501"]);
  assert.equal(two.quote, true);
  // Only a literal true counts.
  const odd = okxSwitches(undefined, { portfolio: { "196": "yes", "1": 1, "8453": null, "501": undefined }, quote: "true" } as unknown as OkxSwitches);
  assert.deepEqual(enabledNetworks(odd), []);
  assert.equal(odd.quote, false);
});

test("this build's own switches: whatever is committed, the environment of this process did not add to it", () => {
  const committed = okxSwitches(undefined);
  for (const chainIndex of OKX_CHAIN_INDEXES) assert.equal(OKX_SWITCHES.portfolio[chainIndex] && !committed.portfolio[chainIndex], false);
  assert.equal(OKX_SWITCHES.quote && !committed.quote, false);
});
