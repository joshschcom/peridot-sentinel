import type { Metadata } from "next";
import { Circuits } from "@/components/pages/circuits";

export const metadata: Metadata = { title: "Circuits" };

export default function CircuitsPage() {
  return <Circuits />;
}
