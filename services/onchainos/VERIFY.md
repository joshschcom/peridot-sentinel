# Verify a deployed OKX reader

Claude runs this after Fable deploys the Node routes. Run from the repository root on Node 22 or newer, using an HTTPS origin and a new evidence filename. The verifier uses the deployed app and four fixed public RPC endpoints. It takes no credentials. Only the selected report file receives evidence.

```sh
node services/onchainos/verify-live.mjs --base-url="$APP_ORIGIN" --out=evidence/session11-okx/hosted-01.json
```

The report records the SHA-256 of the app origin, client observation times, round-trip latency, per-network provider status/reason and RPC identity, and an independent raw balance at an EVM block number and hash or finalized Solana slot. Each app inventory read and its independent observation start together. The HTTP timestamps can include a cached observation; OKX does not report its indexed balance block. Movement between those observations can yield an honest disagreement.

## Public watch subjects

These are stable protocol account identities. The verifier checks for a positive native balance on both sides at run time.

| Network | Chain index and public subject | Reason for selecting it |
| --- | --- | --- |
| X Layer | `196:0xe538905cf8410324e03A5A23C1c177a474D59b2b` | Published WOKB contract. Wrapping native OKB gives the contract a native reserve. [X Layer contracts](https://web3.okx.com/onchainos/dev-docs/xlayer/developer/build-on-xlayer/contracts) |
| Ethereum | `1:0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2` | Ethereum WETH9 contract. Its native ETH reserve backs deposits. [Canonical WETH in the Uniswap SDK](https://github.com/Uniswap/sdks/blob/main/sdks/sdk-core/src/entities/weth9.ts) |
| Base | `8453:0x4200000000000000000000000000000000000006` | Base mainnet WETH9 predeploy. The protocol address persists as its ETH reserve changes. [Base contract addresses](https://docs.base.org/specifications/reference/base-contracts) |
| Solana | `501:So11111111111111111111111111111111111111112` | Long-lived Token Program native mint account. The independent check measures this account’s own lamports, including its rent reserve. It does not measure wrapped SOL held in users’ token accounts. [Native mint](https://solana.com/docs/tokens/basics/sync-native) · [Mint accounts and rent](https://solana.com/docs/tokens/basics/create-mint) |

X Layer, Ethereum and Base use `https://rpc.xlayer.tech`, `https://ethereum-rpc.publicnode.com` and `https://mainnet.base.org`. The verifier checks the EVM chain ID, reads the balance at an explicit block and rechecks that block’s hash. Solana uses `https://api.mainnet-beta.solana.com`, verifies the mainnet genesis hash and records the finalized slot returned with the balance. Lamports are parsed from the exact JSON number token. [Ethereum RPC](https://ethereum.publicnode.com/) · [Solana network identity](https://docs.anza.xyz/clusters/available) · [Solana getBalance](https://solana.com/docs/rpc/http/getbalance)

## Interpreting the result

- An `agree` requires a unique native token with the expected chain symbol and a null contract address, a positive independent balance, and an absolute difference of at most **0.00000001 ETH or OKB** (10,000,000,000 wei) or **0.000000001 SOL** (one lamport). There is no percentage tolerance. A provided raw amount also needs to match the displayed decimal within that bound. A provider snapshot older than five minutes remains unverified. Public wrapper reserves can move within the observation window.
- A successfully reported `unsupported` or `not-entitled` network remains disabled. `verifiedChainIndices` lists only agreements. An empty or stale inventory, absent native marker, failed RPC or material discrepancy cannot verify a network.
- The quote check requires chain 196, the fixed WOKB and USDC addresses, exactly one WOKB input in raw units, a positive raw output and an observation within one minute. It requests an indicative quote only.
- The invalid request must return HTTP 400 with the fixed error. An external client cannot observe whether a remote server contacted its provider. The reader's instrumented synthetic invalid-input test supplies that zero-call check.
- Route responses are checked for credential patterns and unexpected fields. The report contains allowlisted fields and fixed failure labels. Raw response bodies, headers, URLs and error messages are omitted. A failed check produces a report and exits with code 1. A completed run awaits Claude's inspection before a frontend switch changes.

Run the isolated tests with `node --test services/onchainos/verify-live.test.mjs`. Their app and independent RPC traffic terminates at a local stub. Synthetic tests establish the verifier’s behavior and provide no live balance or provider evidence.
