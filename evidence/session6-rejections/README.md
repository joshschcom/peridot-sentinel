# Independent lending-policy rejections

The runner uses the Studio SDK to compile, prove and register the 5,000 bps market policy through the M4 registry, then creates and activates its isolated market B. The deployer owns each demo account. The run supplies 200 mUSD to B's debt book and 100 mCOL to the B account's collateral book. It keeps the original 6,500 bps market A and the same 5,500 bps personal policy on both accounts. The test assets are valueless. The chain-1952 policy processor is the Peridot development reference implementation.

At each intentional borrow the runner first verifies the expected typed denial, submits with an explicit 2,000,000 gas limit, and requires a mined receipt with reverted status. A receipt does not carry revert text. The script replays the exact sender, recipient, calldata and gas limit with eth_call at both the parent block and canonical receipt block to recover and decode the matching custom error. A transient accrued-state call through Multicall3 replicates the controller's accrue-then-preview order. It independently evaluates the two processor circuits with the exact shared context at the receipt block and checks cash, reserve, borrow cap, freshness and protocol LTV. Stored account debt must match before and after.

The [private fork capture](fork-0bbba083c2316e66.json) simulated the public profile from testnet block 47,248,681 on Anvil port 19636. In 15 receipts, two expected mined reverts returned the opposing decisions at 5,800 and 5,200 bps. Re-running against the same private node and journal left the head at block 47,248,696. The two preceding price writes refreshed the timestamps at their existing mock prices.

From the repository root, use a dedicated loopback terminal and journal for a fresh rehearsal.

```sh
anvil --host 127.0.0.1 --port 19636 --chain-id 1952 --fork-url https://testrpc.xlayer.tech --fork-block-number 47248681 --no-storage-caching --silent
node contracts/expansion/script/independent-rejections.mjs fork
```

The public counterpart is `node contracts/expansion/script/independent-rejections.mjs testnet` in the designated deployer environment. It requires the journal helper, verified M4 deployment and the designated M4 testnet owner. Its confirmed evidence output is `public-1952.json`. A public claim requires the public capture. Re-run the same command after a recoverable read interruption to reconcile reserved hashes.
