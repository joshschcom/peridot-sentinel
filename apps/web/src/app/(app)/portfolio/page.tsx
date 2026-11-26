import type { Metadata } from "next";
import { SentinelOverview } from "@/components/pages/sentinel-overview";

export const metadata: Metadata = { title: "Sentinel" };

export default function SentinelPage() {
  return <SentinelOverview />;
}
