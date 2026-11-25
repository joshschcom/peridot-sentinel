import type { Metadata } from "next";
import { StudioMarket } from "@/components/pages/studio";

export const metadata: Metadata = { title: "Studio market" };

export default async function StudioMarketPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <StudioMarket id={decodeURIComponent(id)} />;
}
