import type { Metadata } from "next";
import { Suspense } from "react";
import { MarketsList } from "@/components/pages/markets-list";

export const metadata: Metadata = { title: "Earn and borrow" };

export default function MarketsPage() {
  // The list reads `?view=earn|borrow`; Suspense keeps the page statically prerendered.
  return (
    <Suspense fallback={null}>
      <MarketsList />
    </Suspense>
  );
}
