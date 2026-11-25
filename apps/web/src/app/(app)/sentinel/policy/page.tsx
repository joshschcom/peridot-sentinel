import type { Metadata } from "next";
import { SentinelPolicy } from "@/components/pages/sentinel-policy";

export const metadata: Metadata = { title: "Sentinel policy" };

export default function SentinelPolicyPage() {
  return <SentinelPolicy />;
}
