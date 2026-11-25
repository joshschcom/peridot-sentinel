import type { Metadata } from "next";
import { StudioCreate } from "@/components/pages/studio-create";

export const metadata: Metadata = { title: "Create a market" };

export default function StudioCreatePage() {
  return <StudioCreate />;
}
