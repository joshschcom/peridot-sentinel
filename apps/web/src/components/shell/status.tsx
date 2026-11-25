"use client";
import { useState } from "react";
import { Button, cx } from "@/components/ui/core";
import { IconAlert, IconInfo } from "@/components/ui/icons";
import { Sheet } from "@/components/ui/sheet";
import { useWallet } from "@/hooks/use-wallet";
import { TARGET_DETAIL, TARGET_KIND, TARGET_LABEL, WRITE_CHAIN, WRITE_CHAIN_ID, chainName } from "@/lib/chains";
import { mapContractError } from "@/lib/errors";
import { RUNTIME, services } from "@/services";

/** Persistent network label. This build only ever targets X Layer testnet for writes. */
export function NetworkPill({ className }: { className?: string }) {
  return (
    <span className={cx("inline-flex h-8 items-center gap-2 rounded-full border border-line-strong px-3 text-xs font-medium whitespace-nowrap", className)} title={`${WRITE_CHAIN.name}, chain ${WRITE_CHAIN_ID}. Test tokens only.`} data-testid="network-pill">
      <span className="size-1.5 rounded-full bg-warning" aria-hidden="true" />
      {TARGET_LABEL}
      <span className="num hidden text-faint sm:inline">{TARGET_DETAIL}</span>
    </span>
  );
}

/**
 * FIXTURE MODE banner. Rendered whenever any data service resolves to fixture data
 * (derived from RUNTIME, the same object the service registry and the write lock use).
 * It is not dismissible.
 */
export function FixtureBanner() {
  const [open, setOpen] = useState(false);
  if (!RUNTIME.fixture) return null;
  const modes = Object.entries(RUNTIME.modes);
  return (
    <>
      <div role="status" data-testid="fixture-banner" className="border-b border-warning bg-warning-soft">
        <div className="mx-auto flex min-h-10 max-w-[100rem] items-center gap-x-3 gap-y-1 px-4 py-1.5 text-[0.8125rem] sm:px-6">
          <span className="shrink-0 rounded bg-warning px-1.5 py-0.5 text-[0.6875rem] leading-4 font-semibold tracking-wider text-bg uppercase">Fixture mode</span>
          <span className="min-w-0 flex-1 text-fg">
            <span className="font-medium">Example data, not live chain data.</span> <span className="hidden text-muted sm:inline">{TARGET_KIND === "local" ? "Not connected to the local deployment." : "No contract is deployed on testnet yet."} Writes are disabled.</span>
          </span>
          <button type="button" onClick={() => setOpen(true)} className="inline-flex min-h-8 shrink-0 items-center gap-1 rounded-md px-1 font-medium text-warning underline-offset-4 hover:underline">
            <IconInfo size={15} /> Why?
          </button>
        </div>
      </div>
      <Sheet open={open} onClose={() => setOpen(false)} title="This build shows example data">
        <div className="space-y-4 text-sm">
          <p className="text-muted">
            Every balance, market, position and activity entry in the app is an explicitly labelled example. Nothing is read from X Layer, no transaction can be sent, and example records have no addresses or transaction hashes.
          </p>
          <div className="rounded-control border border-line p-3.5">
            <div className="eyebrow mb-1.5">Reason</div>
            <p>{RUNTIME.fixtureReason}</p>
          </div>
          <dl className="divide-y divide-line rounded-control border border-line px-3.5">
            {modes.map(([name, mode]) => (
              <div key={name} className="flex items-center justify-between gap-4 py-2.5">
                <dt className="capitalize">{name} data</dt>
                <dd className={cx("text-xs font-medium tracking-wide uppercase", mode.source === "fixture" ? "text-warning" : "text-success")}>{mode.source === "fixture" ? "Fixture" : "Live"}</dd>
              </div>
            ))}
          </dl>
          <p className="text-faint">
            The app switches to live data per feature once <code className="font-mono text-xs">packages/chain-config/deployments/{WRITE_CHAIN_ID}.json</code> reports a verified deployment. Policy hashes, gate counts and circuit previews are real compiler output even in this mode.
          </p>
        </div>
      </Sheet>
    </>
  );
}

/** Blocks writes and offers a switch whenever a connected wallet is not on chain 1952 (mainnet 196 included). */
export function WrongNetworkBanner() {
  const wallet = useWallet();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (wallet.status !== "connected" || wallet.chainId === WRITE_CHAIN_ID) return null;
  const switchNetwork = async () => {
    setBusy(true);
    setError(null);
    try {
      await services.wallet.switchToWriteChain();
    } catch (cause) {
      setError(mapContractError(cause).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div role="alert" data-testid="wrong-network-banner" className="border-b border-danger bg-danger-soft">
      <div className="mx-auto flex max-w-[100rem] flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2 text-sm sm:px-6">
        <IconAlert size={18} className="shrink-0 text-danger" />
        <p className="min-w-0 flex-1">
          <span className="font-medium">Wrong network.</span> Your wallet is on {chainName(wallet.chainId)}. Transactions are blocked until you switch to {WRITE_CHAIN.name}.
          {error ? <span className="mt-0.5 block text-danger">{error}</span> : null}
        </p>
        <Button size="sm" onClick={switchNetwork} disabled={busy}>
          {busy ? "Switching…" : "Switch network"}
        </Button>
      </div>
    </div>
  );
}
