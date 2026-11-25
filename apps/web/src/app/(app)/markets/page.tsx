import type { Metadata } from "next";
import { MarketsList } from "@/components/pages/markets-list";

export const metadata: Metadata = { title: "Markets" };

export default function MarketsPage() {
  return <MarketsList />;
}
