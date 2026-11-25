/**
 * Per-browser memory of operator addresses this wallet authorised. It only supplies CANDIDATES to read from the
 * chain (`operators(address)` stays authoritative): a grant older than the scanned log window would otherwise be
 * invisible, and an invisible active grant cannot be revoked from the UI.
 */
const key = (chainId: number, account: string) => `peridot:operators:v1:${chainId}:${account.toLowerCase()}`;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

export function rememberedOperators(chainId: number, account: string): `0x${string}`[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(key(chainId, account)) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((entry): entry is `0x${string}` => typeof entry === "string" && ADDRESS.test(entry)).slice(0, 16) : [];
  } catch {
    return [];
  }
}

export function rememberOperator(chainId: number, account: string, operator: string): void {
  if (typeof window === "undefined" || !ADDRESS.test(operator)) return;
  try {
    const next = [...new Set([operator.toLowerCase(), ...rememberedOperators(chainId, account).map((entry) => entry.toLowerCase())])].slice(0, 16);
    window.localStorage.setItem(key(chainId, account), JSON.stringify(next));
  } catch {
    // Storage can be unavailable (private mode). The log window and the keeper scope still supply candidates.
  }
}
