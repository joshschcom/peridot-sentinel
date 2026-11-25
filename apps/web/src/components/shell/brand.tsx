import Link from "next/link";
import { PeridotMark } from "@/components/ui/icons";

export function Brand({ href = "/", compact = false }: { href?: string; compact?: boolean }) {
  return (
    <Link href={href} className="inline-flex items-center gap-2 rounded-md" aria-label="Peridot Markets home">
      <PeridotMark size={24} />
      <span className="text-[1.0625rem] font-semibold tracking-tight">
        Peridot{compact ? null : <span className="font-normal text-muted"> Markets</span>}
      </span>
    </Link>
  );
}
