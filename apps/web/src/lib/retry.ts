/**
 * Bounded retry with backoff for READS only. The public X Layer testnet RPC is load-balanced over backends that
 * are not always in sync: a read can fail, or briefly miss state that was just written. Writes are never retried.
 */
export async function retryRead<T>(read: () => Promise<T>, options: { attempts?: number; baseDelayMs?: number; accept?: (value: T) => boolean } = {}): Promise<T> {
  const attempts = Math.max(1, options.attempts ?? 4);
  const base = options.baseDelayMs ?? 400;
  let last: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, base * 2 ** (attempt - 1)));
    try {
      const value = await read();
      // `accept` lets a caller treat a suspicious answer (for example empty bytecode) as "ask again" until the last attempt.
      if (!options.accept || options.accept(value) || attempt === attempts - 1) return value;
    } catch (error) {
      last = error;
      if (attempt === attempts - 1) throw error;
    }
  }
  throw last;
}
