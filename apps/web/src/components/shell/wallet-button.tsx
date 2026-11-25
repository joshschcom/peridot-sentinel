"use client";
import { useState } from "react";
import { Button, Notice } from "@/components/ui/core";
import { IconAlert, IconChevronRight, IconWallet } from "@/components/ui/icons";
import { Sheet } from "@/components/ui/sheet";
import { useWallet } from "@/hooks/use-wallet";
import { WRITE_CHAIN, WRITE_CHAIN_ID, chainName } from "@/lib/chains";
import { mapContractError } from "@/lib/errors";
import { shortAddress } from "@/lib/format";
import { services } from "@/services";

export function WalletButton() {
  const wallet = useWallet();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);

  const connect = async (id: string) => {
    setPending(id);
    setError(null);
    try {
      await services.wallet.connect(id);
      setOpen(false);
    } catch (cause) {
      setError(mapContractError(cause).message);
    } finally {
      setPending(null);
    }
  };

  if (wallet.status === "connected") {
    const wrong = wallet.chainId !== WRITE_CHAIN_ID;
    return (
      <>
        <button type="button" onClick={() => setOpen(true)} className="inline-flex h-10 items-center gap-2 rounded-full border border-line-strong pr-3.5 pl-3 text-sm font-medium hover:bg-raised" data-testid="wallet-connected">
          <span className={`size-2 rounded-full ${wrong ? "bg-danger" : "bg-success"}`} aria-hidden="true" />
          <span className="num font-mono text-[0.8125rem]">{shortAddress(wallet.address)}</span>
        </button>
        <Sheet open={open} onClose={() => setOpen(false)} title="Wallet">
          <dl className="divide-y divide-line text-sm">
            <div className="flex justify-between gap-4 py-2.5">
              <dt className="text-muted">Wallet</dt>
              <dd>{wallet.connectorName}</dd>
            </div>
            <div className="flex justify-between gap-4 py-2.5">
              <dt className="text-muted">Address</dt>
              <dd className="font-mono text-[0.8125rem] break-all">{wallet.address}</dd>
            </div>
            <div className="flex justify-between gap-4 py-2.5">
              <dt className="text-muted">Network</dt>
              <dd className={wrong ? "text-danger" : ""}>{chainName(wallet.chainId)}</dd>
            </div>
          </dl>
          {services.wallet.source === "fixture" ? (
            <Notice tone="warning" className="mt-4" title="Example wallet">
              A placeholder used for screenshots and tests. It cannot sign anything.
            </Notice>
          ) : null}
          <Button
            variant="secondary"
            className="mt-5 w-full"
            onClick={async () => {
              await services.wallet.disconnect();
              setOpen(false);
            }}
          >
            Disconnect
          </Button>
        </Sheet>
      </>
    );
  }

  const connectors = open ? services.wallet.listConnectors() : [];
  return (
    <>
      <Button size="sm" className="h-10 px-4" onClick={() => setOpen(true)} disabled={wallet.status === "connecting"} data-testid="wallet-connect">
        <IconWallet size={16} />
        {wallet.status === "connecting" ? "Connecting…" : "Connect"}
      </Button>
      <Sheet open={open} onClose={() => setOpen(false)} title="Connect a wallet">
        <p className="text-sm text-muted">This build targets {WRITE_CHAIN.name} (chain {WRITE_CHAIN_ID}) and will never ask you to switch to a mainnet. Use a wallet that holds test funds only.</p>
        <ul className="mt-4 space-y-2">
          {connectors.map((connector) => (
            <li key={connector.id}>
              <button
                type="button"
                onClick={() => connect(connector.id)}
                disabled={pending !== null}
                className="flex min-h-14 w-full items-center gap-3 rounded-control border border-line px-4 text-left text-[0.9375rem] font-medium hover:border-line-strong hover:bg-raised disabled:opacity-50"
              >
                {connector.icon ? (
                  // eslint-disable-next-line @next/next/no-img-element -- EIP-6963 icons are data URIs announced by the wallet
                  <img src={connector.icon} alt="" width={24} height={24} className="size-6 rounded" />
                ) : (
                  <IconWallet size={22} className="text-muted" />
                )}
                <span className="flex-1">{connector.name === "Injected" ? "Browser wallet" : connector.name}</span>
                <span className="text-faint">{pending === connector.id ? "Check wallet…" : <IconChevronRight size={18} />}</span>
              </button>
            </li>
          ))}
        </ul>
        {connectors.length === 0 ? (
          <Notice icon={<IconAlert size={18} />} title="No wallet detected">
            Install OKX Wallet or MetaMask, then reload this page.
          </Notice>
        ) : null}
        {error ? (
          <Notice tone="danger" icon={<IconAlert size={18} />} className="mt-4" title="Could not connect">
            {error}
          </Notice>
        ) : null}
        <p className="mt-4 text-xs text-faint">Connecting shares your public address only. Peridot never asks for a seed phrase or private key.</p>
      </Sheet>
    </>
  );
}
