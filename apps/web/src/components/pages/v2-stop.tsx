"use client";
/**
 * Emergency stop for a Sentinel v2 account: the owner's `revokeAllOperators()`. A v2 account enumerates its
 * operators, so unlike v1 this list is complete by construction. Rendered only when the connected wallet owns a v2
 * account on the build's target. Signing follows the deployment's own switch (see `V2_OWNER_TARGET`).
 */
import { useQuery } from "@tanstack/react-query";
import { TxFeedback } from "@/components/domain/tx-feedback";
import { Button, Card, Mono } from "@/components/ui/core";
import { IconAlert, IconLock } from "@/components/ui/icons";
import { useChainTx } from "@/hooks/use-chain-tx";
import { useWallet, useWriteGate } from "@/hooks/use-wallet";
import { WRITE_CHAIN_ID } from "@/lib/chains";
import { shortAddress } from "@/lib/format";
import { V2_OWNER_TARGET, readOwnerV2, revokeAllPlan } from "@/services/chain/v2-owner";
import type { Address } from "@/services/types";

export function V2EmergencyStop() {
  const wallet = useWallet();
  const gate = useWriteGate("account");
  const tx = useChainTx();
  const target = V2_OWNER_TARGET;
  const owner = wallet.status === "connected" && wallet.chainId === target?.chainId ? (wallet.address as Address) : null;
  const state = useQuery({ queryKey: ["v2-owner", target?.chainId, owner], queryFn: () => readOwnerV2(target!, owner!), enabled: target !== null && owner !== null, staleTime: 15_000, retry: 1 });
  const account = state.data?.base ?? null;
  if (!target || !owner || !account) return null;
  const count = account.operators.length;
  const allowed = target.writes && gate.allowed;
  const busy = tx.state.phase === "running";
  return (
    <Card as="section" className="border-danger" data-testid="v2-emergency-stop" data-operators={count} data-account={account.account}>
      <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
        <div className="flex min-w-0 gap-3.5">
          <span className="grid size-9 shrink-0 place-items-center rounded-full bg-danger-soft text-danger">
            <IconAlert size={18} />
          </span>
          <div className="min-w-0">
            <h2 className="text-base font-semibold tracking-tight">Emergency stop · Sentinel v2 account</h2>
            <p className="mt-1 max-w-xl text-sm text-muted">
              One transaction, revokeAllOperators(), ends every grant of every operator on account <Mono>{shortAddress(account.account)}</Mono> at once. Your tokens and positions are not touched.
            </p>
            <p className="mt-2 text-[0.8125rem]" data-testid="v2-stop-scope">
              {count === 0 ? <span className="text-muted">Nothing to stop: the account lists no operator (read at block {account.block.number.toLocaleString("en-US")}).</span> : <span>Now listed by the account: {account.operators.map((operator) => shortAddress(operator)).join(", ")}.</span>}
            </p>
          </div>
        </div>
        <Button variant="danger" size="lg" className="shrink-0" disabled={!allowed || count === 0 || busy} onClick={() => void tx.run(revokeAllPlan(account.account), "All operators revoked on your v2 account.")} data-testid="v2-stop-submit">
          {!allowed ? <IconLock size={16} /> : null} Revoke all operators
        </Button>
      </div>
      {!target.writes ? <p className="border-t border-line px-5 py-3 text-[0.8125rem] text-muted sm:px-6" data-testid="v2-stop-locked">{target.writesReason}</p> : !gate.allowed ? <p className="border-t border-line px-5 py-3 text-[0.8125rem] text-muted sm:px-6">{gate.message}</p> : null}
      {tx.state.phase !== "idle" ? (
        <div className="border-t border-line p-5 sm:p-6">
          <TxFeedback state={tx.state} chainId={WRITE_CHAIN_ID} />
        </div>
      ) : null}
    </Card>
  );
}
