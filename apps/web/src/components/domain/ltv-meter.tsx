import { cx } from "@/components/ui/core";
import { formatBps } from "@/lib/amount";
import type { Maybe } from "@/lib/maybe";

export interface LtvMarker {
  bps: number;
  label: string;
  tone?: "neutral" | "warning" | "danger";
}

/**
 * Loan-to-value on a 0-100% track with the limits that govern it.
 * `after` draws the previewed value on top of the current one.
 */
export function LtvMeter({ value, after, markers, className }: { value: Maybe<number>; after?: Maybe<number>; markers: LtvMarker[]; className?: string }) {
  const clamp = (bps: number) => Math.max(0, Math.min(100, bps / 100));
  const current = value.status === "ok" ? clamp(value.value) : null;
  const next = after && after.status === "ok" ? clamp(after.value) : null;
  const sorted = [...markers].sort((a, b) => a.bps - b.bps);
  const worst = next ?? current ?? 0;
  const firstBreached = sorted.find((marker) => worst * 100 > marker.bps);
  const fill = !firstBreached ? "bg-fg" : firstBreached.tone === "danger" ? "bg-danger" : "bg-warning";
  return (
    <div className={className}>
      <div className="relative h-2.5 rounded-full bg-raised" role="img" aria-label={`Loan-to-value ${current === null ? "unavailable" : `${current}%`}${next !== null ? `, after this action ${next}%` : ""}`}>
        {next !== null && current !== null && next > current ? <div className={cx("absolute inset-y-0 left-0 rounded-full opacity-35", fill)} style={{ width: `${next}%` }} /> : null}
        {current !== null ? <div className={cx("absolute inset-y-0 left-0 rounded-full", next !== null && next < current ? "bg-line-strong" : next === null ? fill : "bg-fg")} style={{ width: `${current}%` }} /> : null}
        {next !== null && current !== null && next < current ? <div className="absolute inset-y-0 left-0 rounded-full bg-fg" style={{ width: `${next}%` }} /> : null}
        {sorted.map((marker) => (
          <div key={marker.label} className={cx("absolute -top-1 -bottom-1 w-px", marker.tone === "danger" ? "bg-danger" : marker.tone === "warning" ? "bg-warning" : "bg-line-strong")} style={{ left: `${clamp(marker.bps)}%` }} />
        ))}
      </div>
      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        {sorted.map((marker) => (
          <li key={marker.label} className="inline-flex items-center gap-1.5">
            <span className={cx("h-2.5 w-px", marker.tone === "danger" ? "bg-danger" : marker.tone === "warning" ? "bg-warning" : "bg-line-strong")} aria-hidden="true" />
            {marker.label} <span className="num text-fg">{formatBps(marker.bps)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
