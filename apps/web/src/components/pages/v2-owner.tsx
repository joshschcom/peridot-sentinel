"use client";
/**
 * Owner flows on Sentinel v2 from the connected wallet: create your own account at the base factory and at the vault
 * factory, fund them with test tokens, supply collateral through the lending adapter, grant a bounded swap to an
 * operator, revoke everything, and deposit into / withdraw from / redeem from the vault with a stated bound.
 *
 * Rendered only where the target's own switch allows writes (today: the local development chain), and every button
 * stays locked until the browser has matched the deployment (`verifyOwnerTarget`). Accounts are resolved from the
 * factories for the connected wallet; no address comes from a manifest. All tokens, prices, the venue and the vault
 * are mocks, and the page says so.
 */
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { isAddress } from "viem";
import { TxFeedback } from "@/components/domain/tx-feedback";
import { Badge, Button, Card, CardHeader, DefinitionRow, Mono, Notice, Skeleton, cx } from "@/components/ui/core";
import { IconAlert, IconLock } from "@/components/ui/icons";
import { useChainTx } from "@/hooks/use-chain-tx";
import { useWallet, useWriteGate } from "@/hooks/use-wallet";
import { formatAmount, parseAmount } from "@/lib/amount";
import { TARGET_LABEL, WRITE_CHAIN_ID } from "@/lib/chains";
import { shortAddress } from "@/lib/format";
import type { V2OwnerTarget, V2Token, V2VaultTarget } from "@/lib/v2-target";
import { type OwnerBaseAccount, type OwnerVaultAccount, type VaultAction, createBaseAccountPlan, createVaultAccountPlan, mintToAccountPlan, quoteVault, readOwnerV2, setSwapGrantPlan, setVaultLimitsPlan, supplyCollateralPlan, vaultActionPlan, verifyOwnerTarget } from "@/services/chain/v2-owner";
import type { Address } from "@/services/types";
import { V2EmergencyStop } from "./v2-stop";

const INPUT = "mt-1.5 h-11 w-full min-w-0 rounded-control border border-line-strong bg-bg px-3 text-[0.9375rem] outline-none focus:border-fg";
const utc = (seconds: bigint) => `${new Date(Number(seconds) * 1000).toISOString().slice(0, 16).replace("T", " ")} UTC`;
const amountOf = (text: string, decimals: number): bigint | null => {
  const parsed = parseAmount(text, decimals);
  return parsed.ok && parsed.value > 0n ? parsed.value : null;
};
const show = (value: bigint, token: { symbol: string; decimals: number }) => `${formatAmount(value, token.decimals, { maxFractionDigits: 6 })} ${token.symbol}`;

export function V2OwnerFlows({ target }: { target: V2OwnerTarget }) {
  const wallet = useWallet();
  const gate = useWriteGate("account");
  const owner = wallet.status === "connected" && wallet.chainId === target.chainId ? (wallet.address as Address) : null;
  const check = useQuery({ queryKey: ["v2-owner-verify", target.chainId], queryFn: () => verifyOwnerTarget(target), staleTime: 60_000, retry: 1 });
  const state = useQuery({ queryKey: ["v2-owner", target.chainId, owner], queryFn: () => readOwnerV2(target, owner!), enabled: owner !== null, staleTime: 10_000, retry: 1 });
  const verified = check.data?.ok === true;
  const allowed = target.writes && verified && gate.allowed;
  const lock = !target.writes ? target.writesReason : check.isPending ? "Verifying the v2 deployment on this chain…" : !verified ? "Writes are blocked: the v2 deployment could not be verified on this chain." : !gate.allowed ? gate.message : null;

  return (
    <div className="space-y-6" data-testid="v2-owner" data-chain={target.chainId} data-writes={String(allowed)}>
      <Card as="section" data-testid="v2-verify" data-state={check.isPending ? "loading" : check.isError ? "error" : verified ? "ok" : "failed"} data-block={check.data?.block.number.toString() ?? ""}>
        <CardHeader eyebrow={TARGET_LABEL} title="Sentinel v2 on this chain" description={target.label} action={<Badge tone={verified ? "success" : check.isPending ? "neutral" : "danger"}>{check.isPending ? "Verifying" : verified ? "Deployment verified" : "Not verified"}</Badge>} />
        <div className="p-5 text-sm sm:p-6">
          {check.isPending ? (
            <Skeleton className="h-10" />
          ) : check.isError ? (
            <p className="text-danger">The deployment could not be checked: the RPC did not answer. Nothing can be signed.</p>
          ) : verified ? (
            <p className="text-muted">
              Checked in your browser at block {check.data.block.number.toLocaleString("en-US")}: the chain id{target.anvil ? ", the node's instance id and genesis block" : ""}, the recorded code at {check.data.contracts} contract addresses, and the factories' adapter and policy bindings. Tokens, prices, the swap venue{target.vault ? " and the vault" : ""} are mocks.
            </p>
          ) : (
            <Notice tone="danger" icon={<IconAlert size={18} />} title="This is not the deployment the manifest describes">
              <ul className="list-disc space-y-1 pl-4" data-testid="v2-verify-problems">
                {(check.data?.problems ?? []).map((problem) => (
                  <li key={problem}>{problem}</li>
                ))}
              </ul>
            </Notice>
          )}
        </div>
      </Card>

      {!owner ? (
        <Notice title="Connect the owner wallet">Your v2 accounts are found through the factories for the connected wallet on this chain. No account is shown without one.</Notice>
      ) : state.isPending ? (
        <Skeleton className="h-64" data-loading />
      ) : state.isError || !state.data ? (
        <Notice tone="warning" icon={<IconAlert size={18} />} title="Your v2 accounts could not be read">
          Nothing is shown in their place. {state.error instanceof Error ? state.error.message.split("\n")[0] : ""}
        </Notice>
      ) : (
        <>
          <BaseAccount target={target} account={state.data.base} collateral={state.data.collateral} allowed={allowed} lock={lock} />
          {state.data.base ? <V2EmergencyStop /> : null}
          {target.vault ? <VaultAccount vault={target.vault} account={state.data.vault} allowed={allowed} lock={lock} /> : null}
        </>
      )}
    </div>
  );
}

function Locked({ lock }: { lock: string | null }) {
  return lock ? (
    <p className="text-[0.8125rem] text-muted" data-testid="v2-lock">
      {lock}
    </p>
  ) : null;
}

function BaseAccount({ target, account, collateral, allowed, lock }: { target: V2OwnerTarget; account: OwnerBaseAccount | null; collateral: V2Token | null; allowed: boolean; lock: string | null }) {
  const tx = useChainTx();
  const busy = tx.state.phase === "running";
  const [supply, setSupply] = useState("1");
  const [operator, setOperator] = useState("");
  const [perCall, setPerCall] = useState("1");
  const [total, setTotal] = useState("2");
  const [lifetime, setLifetime] = useState(86_400);
  const { wokb, usdc } = target.tokens;
  const supplyRaw = collateral ? amountOf(supply, collateral.decimals) : null;
  const perCallRaw = amountOf(perCall, wokb.decimals);
  const totalRaw = amountOf(total, wokb.decimals);
  const grantReady = isAddress(operator) && perCallRaw !== null && totalRaw !== null && perCallRaw <= totalRaw;
  const one = (token: V2Token) => 10n ** BigInt(token.decimals);

  return (
    <Card as="section" data-testid="v2-base" data-account={account?.account ?? ""} data-operators={account?.operators.length ?? ""} data-collateral-shares={account?.collateralShares.toString() ?? ""} data-idle-wokb={account?.idleWokb.toString() ?? ""}>
      <CardHeader eyebrow="Base account" title="Your Sentinel v2 account" description="One per wallet. It holds tokens and positions, lends through the lending adapter and swaps through one pinned mock venue. You are its immutable owner." action={account ? <Badge tone="outline">Owner-controlled</Badge> : null} />
      {!account ? (
        <div className="space-y-3 p-5 sm:p-6">
          <p className="text-sm text-muted">This wallet has no v2 account at the factory yet. Creating one attaches the registered account policy {target.accountPolicy ? <Mono>{shortAddress(target.accountPolicy)}</Mono> : null} and deploys your own account contract.</p>
          <Button disabled={!allowed || busy || !target.accountPolicy} onClick={() => void tx.run(createBaseAccountPlan(target), "Your Sentinel v2 account was created.")} data-testid="v2-create-base">
            {!allowed ? <IconLock size={16} /> : null} Create my v2 account
          </Button>
          <Locked lock={lock} />
          <TxFeedback state={tx.state} chainId={WRITE_CHAIN_ID} />
        </div>
      ) : (
        <>
          <dl className="divide-y divide-line px-5 sm:px-6">
            <DefinitionRow label="Account" mono>
              {account.account}
            </DefinitionRow>
            <DefinitionRow label="Idle tokens" stack>
              {show(account.idleWokb, wokb)} · {show(account.idleUsdc, usdc)}
              {collateral && account.idleCollateral !== null ? ` · ${show(account.idleCollateral, collateral)}` : ""}
            </DefinitionRow>
            <DefinitionRow label="Lending position (raw units)" stack>
              collateral shares {account.collateralShares.toString()} · debt {account.debtRaw.toString()}
            </DefinitionRow>
            <DefinitionRow label="Read at block">{account.block.number.toLocaleString("en-US")}</DefinitionRow>
          </dl>

          <div className="space-y-6 border-t border-line p-5 sm:p-6">
            <section className="space-y-3">
              <h3 className="text-sm font-medium">Fund with test tokens</h3>
              <p className="text-[0.8125rem] text-muted">These tokens are valueless fixtures that anyone can mint. They are minted straight to your account, not to your wallet.</p>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="secondary" disabled={!allowed || busy} onClick={() => void tx.run(mintToAccountPlan(wokb, account.account, one(wokb)), `1 ${wokb.symbol} minted to your v2 account.`)} data-testid="v2-mint-wokb">
                  Mint 1 {wokb.symbol}
                </Button>
                {collateral ? (
                  <Button size="sm" variant="secondary" disabled={!allowed || busy} onClick={() => void tx.run(mintToAccountPlan(collateral, account.account, one(collateral)), `1 ${collateral.symbol} minted to your v2 account.`)} data-testid="v2-mint-collateral">
                    Mint 1 {collateral.symbol}
                  </Button>
                ) : null}
              </div>
            </section>

            {collateral && target.lendingMarket ? (
              <section className="space-y-3" data-testid="v2-supply">
                <h3 className="text-sm font-medium">Supply collateral through the lending adapter</h3>
                <p className="text-[0.8125rem] text-muted">{target.lendingMarket.label}. The account supplies its own idle {collateral.symbol}; the pTokens stay on the account.</p>
                <label className="block max-w-xs text-sm">
                  <span className="font-medium">Amount ({collateral.symbol})</span>
                  <input inputMode="decimal" value={supply} onChange={(event) => setSupply(event.target.value.trim())} className={INPUT} data-testid="v2-supply-amount" />
                </label>
                {supplyRaw !== null && account.idleCollateral !== null && supplyRaw > account.idleCollateral ? <p className="text-sm text-danger">Only {show(account.idleCollateral, collateral)} is idle in the account.</p> : null}
                <Button variant="secondary" disabled={!allowed || busy || supplyRaw === null || account.idleCollateral === null || supplyRaw > account.idleCollateral} onClick={() => supplyRaw !== null && void tx.run(supplyCollateralPlan(account.account, collateral.symbol, supplyRaw), `${show(supplyRaw, collateral)} supplied as collateral from your v2 account.`)} data-testid="v2-supply-submit">
                  Supply {collateral.symbol}
                </Button>
              </section>
            ) : null}

            <section className="space-y-3" data-testid="v2-grant">
              <h3 className="text-sm font-medium">Authorise an operator to swap {wokb.symbol}</h3>
              <p className="text-[0.8125rem] text-muted">A swap-only grant on the pinned adapter: at most this much per swap, this much in total, until the expiry. Output always goes to your account, and the execution circuit refuses a price more than {target.swap.policyMaxLossBps / 100}% below the mock price source.</p>
              <label className="block text-sm">
                <span className="font-medium">Operator address</span>
                <input type="text" spellCheck={false} autoComplete="off" value={operator} onChange={(event) => setOperator(event.target.value.trim())} placeholder="0x…" className={cx(INPUT, "font-mono text-[0.8125rem]")} data-testid="v2-grant-operator" />
                <span className="mt-1 block text-xs text-faint">A public address. Never paste a private key on this site.</span>
              </label>
              <div className="grid gap-4 sm:grid-cols-3">
                <label className="block text-sm">
                  <span className="font-medium">Per swap ({wokb.symbol})</span>
                  <input inputMode="decimal" value={perCall} onChange={(event) => setPerCall(event.target.value.trim())} className={INPUT} data-testid="v2-grant-percall" />
                </label>
                <label className="block text-sm">
                  <span className="font-medium">In total ({wokb.symbol})</span>
                  <input inputMode="decimal" value={total} onChange={(event) => setTotal(event.target.value.trim())} className={INPUT} data-testid="v2-grant-total" />
                </label>
                <label className="block text-sm">
                  <span className="font-medium">Valid for</span>
                  <select value={lifetime} onChange={(event) => setLifetime(Number(event.target.value))} className={INPUT} data-testid="v2-grant-lifetime">
                    <option value={3600}>1 hour</option>
                    <option value={86_400}>1 day</option>
                    <option value={604_800}>7 days</option>
                  </select>
                </label>
              </div>
              {perCallRaw !== null && totalRaw !== null && perCallRaw > totalRaw ? <p className="text-sm text-danger">The per-swap limit cannot be above the total.</p> : null}
              <Button disabled={!allowed || busy || !grantReady} onClick={() => grantReady && void tx.run(setSwapGrantPlan(target, account.account, operator as Address, wokb, perCallRaw!, totalRaw!, lifetime), "The swap grant is in force.")} data-testid="v2-grant-submit">
                {!allowed ? <IconLock size={16} /> : null} Sign the grant
              </Button>
              {account.swapGrants.length > 0 ? (
                <ul className="divide-y divide-line rounded-control border border-line text-sm" data-testid="v2-grants">
                  {account.swapGrants.map((grant) => (
                    <li key={`${grant.operator}:${grant.inputAsset.address}`} className="num px-3.5 py-2.5" data-operator={grant.operator} data-remaining={grant.remaining.toString()} data-per-call={grant.maxPerCall.toString()}>
                      <Mono>{shortAddress(grant.operator)}</Mono> may swap {grant.inputAsset.symbol}: {show(grant.maxPerCall, grant.inputAsset)} per swap, {show(grant.remaining, grant.inputAsset)} left, {grant.expired ? "expired" : `until ${utc(grant.expiry)}`}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-[0.8125rem] text-muted" data-testid="v2-grants-empty">No swap grant: no operator can act on this account.</p>
              )}
            </section>
            <Locked lock={lock} />
            <TxFeedback state={tx.state} chainId={WRITE_CHAIN_ID} />
          </div>
        </>
      )}
    </Card>
  );
}

const ACTION_TEXT: Record<VaultAction, { tab: string; amount: string; quote: string; bound: string; button: string }> = {
  deposit: { tab: "Deposit", amount: "Assets to deposit", quote: "Shares for this deposit, by the vault adapter's quote", bound: "You receive at least", button: "Deposit" },
  withdraw: { tab: "Withdraw", amount: "Assets to take out", quote: "Shares this withdrawal burns, by the vault adapter's quote", bound: "It burns at most", button: "Withdraw" },
  redeem: { tab: "Redeem", amount: "Shares to redeem", quote: "Assets for these shares, by the vault adapter's quote", bound: "You receive at least", button: "Redeem" },
};

function VaultAccount({ vault, account, allowed, lock }: { vault: V2VaultTarget; account: OwnerVaultAccount | null; allowed: boolean; lock: string | null }) {
  const tx = useChainTx();
  const busy = tx.state.phase === "running";
  const [cap, setCap] = useState("20");
  const [floor, setFloor] = useState("1");
  const [action, setAction] = useState<VaultAction>("deposit");
  const [amount, setAmount] = useState("");
  const [toleranceBps, setToleranceBps] = useState(50);
  const asset = vault.asset;
  const share = { symbol: "vault shares", decimals: vault.shareDecimals };
  const inUnit = action === "redeem" ? share : asset;
  const outUnit = action === "redeem" ? asset : share;
  const amountRaw = amountOf(amount, inUnit.decimals);
  const capRaw = amountOf(cap, asset.decimals);
  const floorWad = amountOf(floor, 18);
  const quote = useQuery({
    queryKey: ["vault-quote", account?.account, action, amountRaw?.toString(), toleranceBps],
    queryFn: () => quoteVault(vault, account!.account, action, amountRaw!, toleranceBps),
    enabled: account !== null && amountRaw !== null,
    staleTime: 5_000,
    retry: false,
  });
  const text = ACTION_TEXT[action];
  const available = account ? (action === "deposit" ? account.idleAsset : action === "withdraw" ? account.liquidAssets : account.liquidShares) : 0n;
  const tooMuch = amountRaw !== null && amountRaw > available;

  return (
    <Card as="section" data-testid="vault-card" data-account={account?.account ?? ""} data-shares={account?.shares.toString() ?? ""} data-idle={account?.idleAsset.toString() ?? ""} data-cap={account?.maxPositionAssets.toString() ?? ""}>
      <CardHeader eyebrow="Vault account" title="Your vault account" description={`A separate account, also owned by you, that can deposit ${asset.symbol} into one ERC-4626 vault. ${vault.label}`} action={<Badge tone="warning" wrap>Mock vault · no yield</Badge>} />
      {!account ? (
        <div className="space-y-3 p-5 sm:p-6">
          <p className="text-sm text-muted">This wallet has no vault account at the vault factory yet. It is separate from your base v2 account: neither holds the other's tokens, positions or grants.</p>
          <Button disabled={!allowed || busy} onClick={() => void tx.run(createVaultAccountPlan(vault), "Your vault account was created.")} data-testid="vault-create">
            {!allowed ? <IconLock size={16} /> : null} Create my vault account
          </Button>
          <Locked lock={lock} />
          <TxFeedback state={tx.state} chainId={WRITE_CHAIN_ID} />
        </div>
      ) : (
        <>
          <dl className="divide-y divide-line px-5 sm:px-6">
            <DefinitionRow label="Account" mono>
              {account.account}
            </DefinitionRow>
            <DefinitionRow label="Idle in the account">{show(account.idleAsset, asset)}</DefinitionRow>
            <DefinitionRow label="In the vault" stack>
              {show(account.shares, share)} · claim on {show(account.claimAssets, asset)}
            </DefinitionRow>
            <DefinitionRow label="Deposit limits" stack>
              {account.maxPositionAssets === 0n ? "Deposits are off (cap 0)" : `position cap ${show(account.maxPositionAssets, asset)}, at least ${formatAmount(account.minSharesPerAssetWad, 18, { maxFractionDigits: 6 })} share per asset`}
            </DefinitionRow>
          </dl>
          <div className="space-y-6 border-t border-line p-5 sm:p-6">
            <section className="space-y-3">
              <h3 className="text-sm font-medium">Fund with test {asset.symbol}</h3>
              <Button size="sm" variant="secondary" disabled={!allowed || busy} onClick={() => void tx.run(mintToAccountPlan(asset, account.account, 12n * 10n ** BigInt(asset.decimals)), `12 ${asset.symbol} minted to your vault account.`)} data-testid="vault-mint">
                Mint 12 {asset.symbol} to the account
              </Button>
            </section>

            <section className="space-y-3" data-testid="vault-limits">
              <h3 className="text-sm font-medium">Deposit limits</h3>
              <p className="text-[0.8125rem] text-muted">A new vault account accepts no deposit until you set a position cap, and a floor on the shares the vault must give per asset. Both are yours to change at any time.</p>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block text-sm">
                  <span className="font-medium">Position cap ({asset.symbol})</span>
                  <input inputMode="decimal" value={cap} onChange={(event) => setCap(event.target.value.trim())} className={INPUT} data-testid="vault-limit-cap" />
                </label>
                <label className="block text-sm">
                  <span className="font-medium">Minimum shares per asset</span>
                  <input inputMode="decimal" value={floor} onChange={(event) => setFloor(event.target.value.trim())} className={INPUT} data-testid="vault-limit-floor" />
                </label>
              </div>
              <Button variant="secondary" disabled={!allowed || busy || capRaw === null || floorWad === null} onClick={() => capRaw !== null && floorWad !== null && void tx.run(setVaultLimitsPlan(account.account, capRaw, floorWad), "Deposit limits set on your vault account.")} data-testid="vault-limits-submit">
                Set limits
              </Button>
            </section>

            <section className="space-y-3" data-testid="vault-action" data-action={action}>
              <div role="radiogroup" aria-label="Vault action" className="inline-flex rounded-full border border-line p-0.5 text-sm">
                {(["deposit", "withdraw", "redeem"] as const).map((option) => (
                  <button key={option} type="button" role="radio" aria-checked={action === option} onClick={() => { setAction(option); setAmount(""); }} className={cx("h-8 rounded-full px-3.5 font-medium", action === option ? "bg-inverse text-on-inverse" : "text-muted hover:text-fg")} data-testid={`vault-action-${option}`}>
                    {ACTION_TEXT[option].tab}
                  </button>
                ))}
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block text-sm">
                  <span className="font-medium">
                    {text.amount} ({inUnit.symbol})
                  </span>
                  <input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value.trim())} placeholder="0" className={INPUT} data-testid="vault-amount" />
                  <span className="num mt-1 block text-xs text-faint">Available: {show(available, inUnit)}</span>
                </label>
                <label className="block text-sm">
                  <span className="font-medium">Tolerance on the quote</span>
                  <select value={toleranceBps} onChange={(event) => setToleranceBps(Number(event.target.value))} className={INPUT} data-testid="vault-tolerance">
                    <option value={0}>None (exact quote)</option>
                    <option value={50}>0.5%</option>
                    <option value={100}>1%</option>
                  </select>
                </label>
              </div>
              {tooMuch ? <p className="text-sm text-danger">Only {show(available, inUnit)} is available for this.</p> : null}
              {amountRaw !== null ? (
                <div className="rounded-control border border-line p-3.5 text-sm" data-testid="vault-quote" data-state={quote.isPending ? "loading" : quote.isError ? "error" : "ok"} data-quote={quote.data?.quote.toString() ?? ""} data-bound={quote.data?.bound.toString() ?? ""}>
                  {quote.isPending ? (
                    <span className="text-muted">Asking the vault adapter…</span>
                  ) : quote.isError || !quote.data ? (
                    <span className="text-danger">The vault adapter gave no quote for this amount, so it cannot be signed. {quote.error instanceof Error ? quote.error.message.split("\n")[0] : ""}</span>
                  ) : (
                    <dl className="num space-y-1.5">
                      <div className="flex flex-wrap justify-between gap-x-4">
                        <dt className="text-muted">{text.quote}</dt>
                        <dd>{show(quote.data.quote, outUnit)}</dd>
                      </div>
                      <div className="flex flex-wrap justify-between gap-x-4 font-medium">
                        <dt>{text.bound}</dt>
                        <dd data-testid="vault-bound">{show(quote.data.bound, outUnit)}</dd>
                      </div>
                      <p className="text-xs font-normal text-faint">Quoted at block {quote.data.block.number.toLocaleString("en-US")}. The bound above is written into the transaction: if the vault would give you less (or burn more), the transaction reverts and nothing moves. It also carries a 20-minute deadline.</p>
                    </dl>
                  )}
                </div>
              ) : null}
              <Button disabled={!allowed || busy || amountRaw === null || tooMuch || !quote.data} onClick={() => amountRaw !== null && quote.data && void tx.run(vaultActionPlan(account.account, action, amountRaw, quote.data.bound), `${text.tab} confirmed on your vault account.`).then((run) => run.ok && setAmount(""))} data-testid="vault-submit">
                {!allowed ? <IconLock size={16} /> : null} {text.button}
              </Button>
            </section>
            <Locked lock={lock} />
            <TxFeedback state={tx.state} chainId={WRITE_CHAIN_ID} />
          </div>
        </>
      )}
    </Card>
  );
}
