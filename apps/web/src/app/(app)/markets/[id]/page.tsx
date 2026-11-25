import type { Metadata } from "next";
import { MarketDetail } from "@/components/pages/market-detail";

export const metadata: Metadata = { title: "Market" };

export default async function MarketPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <MarketDetail id={decodeURIComponent(id)} />;
}
