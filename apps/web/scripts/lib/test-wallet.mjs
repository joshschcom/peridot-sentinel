// Test-only EIP-1193 provider, injected into the page by the Playwright scripts. It forwards to a loopback
// Anvil RPC and lets the node sign with one of its unlocked accounts: no private key exists anywhere in this repo.
// Options:
//   walletChainId  the chain the "wallet" reports at first (hex). Differs from the node's chain for the wrong-network test.
//   readOnly       refuse eth_sendTransaction (used by the read-only check scripts).
//   watchOnly      a wallet that only REPORTS an address and a chain: nothing is forwarded anywhere, and every
//                  signing or sending method is refused. Used to look at public testnet data for a public address.
// It reports every send and every switch through window.__recordTx / window.__recordSwitch.
export const LOOPBACK_RPC = /^http:\/\/(127\.0\.0\.1|localhost):\d+$/;

export async function jsonRpc(url, method, params = []) {
  const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  const json = await response.json();
  if (json.error) throw new Error(`${method}: ${json.error.message}`);
  return json.result;
}

/** Returns { sent, switches } arrays that fill up as the page uses the wallet. */
export async function installTestWallet(context, { rpcUrl = null, account, walletChainId, readOnly = false, watchOnly = false }) {
  if (watchOnly) readOnly = true;
  else if (!LOOPBACK_RPC.test(rpcUrl ?? "")) throw new Error("The test wallet only forwards to a loopback RPC");
  const sent = [];
  const switches = [];
  const refused = [];
  await context.exposeBinding("__recordTx", (_source, tx) => sent.push(tx));
  await context.exposeBinding("__recordSwitch", (_source, chainId) => switches.push(chainId));
  await context.exposeBinding("__recordRefused", (_source, tx) => refused.push(tx));
  await context.addInitScript(
    ({ rpcUrl, account, walletChainId, readOnly, watchOnly }) => {
      let id = 0;
      let current = walletChainId;
      const call = async (method, params) => {
        const response = await fetch(rpcUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params: params ?? [] }) });
        const json = await response.json();
        if (json.error) throw Object.assign(new Error(json.error.message), { code: json.error.code, data: json.error.data });
        return json.result;
      };
      const listeners = {};
      const emit = (event, value) => (listeners[event] ?? []).forEach((handler) => handler(value));
      window.ethereum = {
        isPeridotTestProvider: true,
        request: async ({ method, params }) => {
          if (method === "eth_requestAccounts" || method === "eth_accounts") return [account];
          if (method === "eth_chainId") return current;
          if (method === "net_version") return String(parseInt(current, 16));
          if (method === "wallet_switchEthereumChain") {
            current = params[0].chainId;
            window.__recordSwitch(current);
            emit("chainChanged", current);
            return null;
          }
          if (method === "wallet_requestPermissions" || method === "wallet_getPermissions") return [{ parentCapability: "eth_accounts" }];
          if (method === "wallet_revokePermissions") return null;
          if (method === "eth_sendTransaction") {
            const tx = { ...params[0], from: account };
            if (readOnly) {
              window.__recordRefused({ to: tx.to, selector: (tx.data ?? "0x").slice(0, 10) });
              throw Object.assign(new Error("This test wallet is read-only"), { code: 4200 });
            }
            const hash = await call(method, [tx]);
            window.__recordTx({ hash, to: tx.to, selector: (tx.data ?? "0x").slice(0, 10) });
            return hash;
          }
          if (watchOnly) {
            window.__recordRefused({ method });
            throw Object.assign(new Error(`This watch-only test wallet does not support ${method}`), { code: 4200 });
          }
          return call(method, params);
        },
        on: (event, handler) => void (listeners[event] ??= []).push(handler),
        removeListener: (event, handler) => void (listeners[event] = (listeners[event] ?? []).filter((entry) => entry !== handler)),
      };
    },
    { rpcUrl, account, walletChainId, readOnly, watchOnly },
  );
  return { sent, switches, refused };
}

export async function connectWallet(page) {
  if (await page.locator('[data-testid="wallet-connected"]:visible').count()) return;
  await page.locator('[data-testid="wallet-connect"]:visible').first().click();
  await page.locator("dialog[open] ul button").first().click();
  await page.locator('[data-testid="wallet-connected"]:visible').first().waitFor({ timeout: 15000 });
}
