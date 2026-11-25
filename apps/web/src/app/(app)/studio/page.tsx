import type { Metadata } from "next";
import { StudioHome } from "@/components/pages/studio";

export const metadata: Metadata = { title: "Studio" };

export default function StudioPage() {
  return <StudioHome />;
}
