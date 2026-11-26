import type { Metadata } from "next";
import { Automate } from "@/components/pages/automate";

export const metadata: Metadata = { title: "Automate" };

export default function AutomatePage() {
  return <Automate />;
}
