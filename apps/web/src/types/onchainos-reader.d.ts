/**
 * Types of the server-side OKX Onchain OS reader (services/onchainos/reader.mjs, contract in READER.md next to it).
 * The reader is plain JavaScript owned by the contracts team; this declaration is the only thing the app assumes
 * about it. `@onchainos/*` is a tsconfig path to services/onchainos. Import it from Node route handlers ONLY: it
 * signs requests with the server's credentials and must never reach a client bundle.
 */
declare module "@onchainos/reader.mjs" {
  import type { OkxHandler } from "@/lib/okx-route";
  export const handlePortfolio: OkxHandler;
  export const handleQuote: OkxHandler;
}
