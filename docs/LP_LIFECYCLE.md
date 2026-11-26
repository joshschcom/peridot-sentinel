# Peridot Sentinel concentrated-liquidity prototype

**FORK only · UI disabled.** This standalone, owner-operated account demonstrates one concentrated-liquidity position in the 0.05% native USDC/WOKB Uniswap v3 pool. Its constructor requires local chain ID 31337 and the pinned venue identities. The deployed Sentinel accounts, public manifests, operator tools and published strategy templates have no LP operation. LP shares carry no borrowing power here.

## Venue and position identity

The upstream pin is X Layer mainnet 196 block `76931173`, hash `0x10908ada4cb486c8d506ba492aca1927e47a5a51e56f19e444f06f46c3acb574`. The factory’s `getPool(nativeUSDC, WOKB, 500)` and the pool’s own factory, token ordering, tick spacing (`10`) and fee (`500` ppm) agree. The position manager reports that factory and WOKB as its wrapped native token. The pool’s active liquidity was `211740884568132709` and its tick was `232229`. The published deployment table identifies the manager, factory and router. [Uniswap X Layer deployments](https://developers.uniswap.org/docs/protocols/v3/deployments/v3-xlayer-deployments)

| Contract | X Layer mainnet address |
| --- | --- |
| NonfungiblePositionManager | `0x315e413A11AB0df498eF83873012430ca36638Ae` |
| UniswapV3Factory | `0x4B2ab38DBF28D31D467aA8993f6c2585981D6804` |
| SwapRouter02 used by the independent fork trader | `0x4f0c28f5926afda16bf2506d5d9e57ea190f9bca` |
| Native USDC, token0, 6 decimals | `0xB6CEceAB302E2E4948951eE7843FC24E92933061` |
| WOKB, token1, 18 decimals | `0xe538905cf8410324e03A5A23C1c177a474D59b2b` |
| Pool | `0x9f73888Fb725A3409548BC8d2e42365AC063E148` |

## Owner operations

| Method | Enforced behavior |
| --- | --- |
| `open(max0,max1,min0,min1,deadline)` | Mints one NFT to the account at fixed ticks `[231630,232830]`. Maximum inputs are 250 USDC and 3 WOKB. Each leg must consume at least 99% of its own signed maximum. Only the pinned manager receives approval, limited to each input maximum. Both allowances return to zero before settlement completes. |
| `position()` | Reads the internally recorded ID, NFT owner, pair, fee, range, operator approval, liquidity, fee-growth snapshots and booked owed amounts directly from the manager. The owner cannot supply an external ID. |
| `collectFees()` | Realizes and collects the position’s accrued fees to the account. Confirms actual balance deltas for both tokens and preserves liquidity. |
| `previewPrincipal()` | Computes both removable principal amounts, rounded down, from the manager’s liquidity and the pool’s current square-root price. |
| `close(min0,min1,deadline)` | Removes all liquidity, collects to the account, burns the NFT and clears the occupied slot. The contract requires each signed minimum to cover at least 99% of spot principal, rounded up. An out-of-range owner can exit one-sided with a zero minimum for the empty leg. |
| `withdraw(token,amount)` | Transfers an idle balance of either pinned underlying to the immutable owner, checking both parties’ actual deltas. |

All state-changing operations check ownership and reentrancy. Mint and close require an unexpired deadline within ten minutes. A tighter minimum in the owner’s signed call remains binding. There are no owner-selectable venues, token approvals, recipients, cross-position calls or operator grants. Lending, leverage, fee reinvestment and rebalancing are outside this profile. [Account source](../contracts/expansion/src/lp7/ForkLiquidityAccount.sol)

The manager’s `positions` call reports stored `tokensOwed`. A swap can generate fees before those stored fields update. The evidence realizes them with `collect` before any principal removal, then compares both the manager event and the account’s actual token increase. A fee amount from a single fork swap supplies no basis for an APR. The fixed square-root limits come from Uniswap’s integer tick arithmetic. [Position manager](https://github.com/Uniswap/v3-periphery/blob/v1.0.0/contracts/NonfungiblePositionManager.sol) · [TickMath](https://github.com/Uniswap/v3-core/blob/v1.0.0/contracts/libraries/TickMath.sol)

## Boundaries and assumptions

- The pool spot price can move or be manipulated. The 99% floor constrains token quantities relative to that spot and the owner’s signed minimums. It offers no independent measure of economic value. Fixed ticks concentrate exposure and the position can become entirely one-sided.
- Operations pin the manager, factory, pool and token runtime code hashes. Native USDC is a proxy. An implementation upgrade can change token behavior while preserving the proxy runtime hash. The fork reproduces a historical state.
- The wrapper only records the ID returned by its own mint. An unrelated NFT forced in by unsafe ERC-721 `transferFrom` remains unsupported and can be stranded. Uniswap also allows an external payer to add liquidity to an existing ID using its own assets. Reads and full removal use the NFT manager’s current liquidity.
- The EVM wrapper has a separate identity and owner. It has no execution-circuit or operator pathway. A public integration would need separate policy, oracle and custody review, deployment evidence and Fable’s UI acceptance.

## Reproduce from the repo root

```sh
forge test --root contracts/expansion --offline --match-path 'test/lp7/*.t.sol' -v
node contracts/expansion/script/lp7/fork.mjs
```

The script checks the upstream block hash and venue, then starts an isolated Anvil on `127.0.0.1:19720`. All writes use unlocked local actors, including the trader that pays the fees. The owner wraps local fork OKB and buys USDC from the genuine forked pool to fund the position. The script records matched logs, native-unit amounts, receipts, hashes and gas, and stops its own Anvil on exit. [Rehearsal script](../contracts/expansion/script/lp7/fork.mjs)

## Recorded fork run

The owner minted NFT `88713` to fork account `0x663F3ad617193148711d28f5334eE4Ed07016602`, with liquidity `306209484647958`. A separate trader then sold 10 WOKB for 821.119640 USDC through the approved pool. The manager paid **0.000005415238405219 WOKB** and zero USDC on the subsequent fee collection. The account’s WOKB increase matched, and liquidity remained unchanged. Removal returned 80.623639 USDC and 1.015433395465150036 WOKB of principal, exactly matching the pre-close preview. The owner withdrew the remaining balances. Both account balances and both allowances to the manager finished at zero. [18 fork receipts and decoded events](../evidence/session7-lp/fork.json)

| Operation | Fork transaction hash | Gas used |
| --- | --- | ---: |
| Mint with 81.809388 USDC and 1.000999980035771246 WOKB | `0x6364f97ec4575a9e24c45aed146666f2067263e55f61ca8deacdf97640770e95` | 565,759 |
| Independent fee-generating swap | `0x5caca5b7468ddafcd0932fb7d660969c4a8eaf39cf0a8582615ad38591d943f8` | 136,058 |
| Collect trading fees | `0x01dea5a97650596cc5a3284952bc73096ea9dd3fba6f025e38d6be7a7df7eaee` | 183,933 |
| Remove all liquidity, collect principal and burn NFT | `0x6e5f25e6e2fe31b639b3a1f20684a0e50517963e914b21b7cab0853e6aedc78f` | 280,120 |

Four deliberately mined reverts covered a second mint into an occupied account, an outsider collecting fees, an outsider withdrawing underlying and a close with both minimums at zero. Two isolated Foundry tests covered public-chain constructor rejection on 196 and 1952, and a missing venue on a local chain. [Tests](../contracts/expansion/test/lp7/ForkLiquidityAccount.t.sol) · [Decoded fork reverts](../evidence/session7-lp/fork.json)
