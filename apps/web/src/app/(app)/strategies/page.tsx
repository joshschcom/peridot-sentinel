import type { Metadata } from "next";
import { Strategies } from "@/components/pages/strategies";

export const metadata: Metadata = { title: "Strategies" };

export default function StrategiesPage() {
  return <Strategies />;
}
