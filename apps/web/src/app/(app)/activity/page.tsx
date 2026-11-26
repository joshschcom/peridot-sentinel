import type { Metadata } from "next";
import { SentinelActivity } from "@/components/pages/sentinel-activity";

export const metadata: Metadata = { title: "Activity" };

export default function ActivityPage() {
  return <SentinelActivity />;
}
