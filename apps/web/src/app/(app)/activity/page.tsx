import type { Metadata } from "next";
import { SentinelActivity } from "@/components/pages/sentinel-activity";

export const metadata: Metadata = { title: "Sentinel activity" };

export default function SentinelActivityPage() {
  return <SentinelActivity />;
}
