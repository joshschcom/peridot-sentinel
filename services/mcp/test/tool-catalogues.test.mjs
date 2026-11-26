import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { buildCatalogue, discoverTools, profiles } from '../generate-tool-catalogues.mjs';

const transactionTools = {
  'sentinel-connect': ['sentinel_execute_auto_repay'],
  'sentinel-connect-v2': ['execute_swap', 'mine_denied_borrow'],
};
const proposalTools = {
  'sentinel-connect': ['sentinel_propose_auto_repay'],
  'sentinel-connect-v2': ['simulate_and_propose_swap', 'simulate_denied_borrow'],
};

for (const profile of profiles) {
  test(profile.name + ' catalogue matches actual stdio discovery and declares its effects', async () => {
    const stored = JSON.parse(readFileSync(new URL('tools.json', profile.directory), 'utf8'));
    const discovered = await discoverTools(profile);
    const wireTools = stored.tools.map(({ writes, journalEffect, guarantees, ...tool }) => tool);
    assert.deepEqual(stored.server, discovered.server);
    assert.deepEqual(wireTools, discovered.tools);
    assert.deepEqual(stored, buildCatalogue(discovered));
    const names = stored.tools.map(tool => tool.name);
    assert.equal(new Set(names).size, names.length);
    assert.deepEqual(stored.tools.filter(tool => tool.writes).map(tool => tool.name), transactionTools[profile.name]);
    assert.deepEqual(stored.tools.filter(tool => tool.journalEffect === 'propose').map(tool => tool.name), proposalTools[profile.name]);
    for (const tool of stored.tools) {
      assert(tool.description.trim());
      assert.equal(tool.inputSchema.additionalProperties, false);
      assert(Object.hasOwn(stored.journalEffects, tool.journalEffect));
      assert(tool.guarantees.length && tool.guarantees.every(item => typeof item === 'string' && item.trim()));
    }
  });
}
