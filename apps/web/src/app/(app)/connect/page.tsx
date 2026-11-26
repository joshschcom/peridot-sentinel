import type { Metadata } from "next";
import { Connect } from "@/components/pages/connect";

export const metadata: Metadata = { title: "Connect" };

export default function ConnectPage() {
  return <Connect />;
}
