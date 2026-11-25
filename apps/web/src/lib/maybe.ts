/**
 * "Unavailable" is not zero. Every value that can fail to load, or that the current
 * data source cannot provide, is wrapped so the UI has to decide how to show its absence.
 */
export type Maybe<T> = { readonly status: "ok"; readonly value: T } | { readonly status: "unavailable"; readonly reason: string };

export const ok = <T>(value: T): Maybe<T> => ({ status: "ok", value });
export const unavailable = <T = never>(reason: string): Maybe<T> => ({ status: "unavailable", reason });
export const isOk = <T>(m: Maybe<T>): m is { status: "ok"; value: T } => m.status === "ok";

export function mapMaybe<T, U>(m: Maybe<T>, fn: (value: T) => U): Maybe<U> {
  return m.status === "ok" ? ok(fn(m.value)) : m;
}

export function all2<A, B>(a: Maybe<A>, b: Maybe<B>): Maybe<readonly [A, B]> {
  if (a.status !== "ok") return a;
  if (b.status !== "ok") return b;
  return ok([a.value, b.value] as const);
}
