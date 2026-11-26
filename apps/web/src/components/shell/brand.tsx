import Link from "next/link";
import { PeridotMark } from "@/components/ui/icons";

/** Wordmark: "sentinel." with "By Peridot" as the secondary line (DECISIONS D11). */
export function Brand({ href = "/", compact = false }: { href?: string; compact?: boolean }) {
  return (
    <Link href={href} className="inline-flex items-center gap-2.5 rounded-md" aria-label="Peridot Sentinel home" data-testid="brand">
      <PeridotMark size={compact ? 22 : 26} />
      <span className="flex flex-col leading-none">
        <span className="text-[1.1875rem] font-semibold tracking-tight">sentinel.</span>
        {compact ? null : <span className="mt-1 text-[0.6875rem] font-medium tracking-wide text-faint">By Peridot</span>}
      </span>
    </Link>
  );
}
