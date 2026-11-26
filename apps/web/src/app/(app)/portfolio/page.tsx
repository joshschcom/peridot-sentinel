import type { Metadata } from "next";
import { PortfolioHome } from "@/components/pages/sentinel-overview";

export const metadata: Metadata = { title: "Portfolio" };

export default function PortfolioPage() {
  return <PortfolioHome />;
}
