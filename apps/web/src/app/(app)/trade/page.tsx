import type { Metadata } from "next";
import { Trade } from "@/components/pages/trade";

export const metadata: Metadata = { title: "Trade" };

export default function TradePage() {
  return <Trade />;
}
