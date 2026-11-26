import type { Metadata } from "next";
import { Discover } from "@/components/pages/discover";

export const metadata: Metadata = { title: "Discover strategies" };

export default function DiscoverPage() {
  return <Discover />;
}
