import {keeperConfig} from './config.js';
import {runOnce} from './worker.js';

try {
  await runOnce(await keeperConfig(),process.argv.includes('--execute'));
} catch {
  console.error('Keeper tick failed. Check the chain, account registration, RPC and signer configuration.');
  process.exitCode = 1;
}
