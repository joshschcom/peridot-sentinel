"use client";
import { useId } from "react";
import { cx } from "@/components/ui/core";
import { formatAmount, parseAmount, parseErrorMessage, toDecimalString } from "@/lib/amount";
import type { TokenInfo } from "@/services/types";

/**
 * Text input for token amounts. The string is parsed with the strict bigint parser;
 * there is no <input type="number"> and no float anywhere on this path.
 */
export function AmountInput({ label, token, value, onChange, max, maxLabel = "Available", disabled }: { label: string; token: TokenInfo; value: string; onChange: (next: string) => void; max?: bigint; maxLabel?: string; disabled?: boolean }) {
  const id = useId();
  const parsed = parseAmount(value, token.decimals);
  const showError = value.trim() !== "" && !parsed.ok;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <label htmlFor={id} className="font-medium">
          {label}
        </label>
        {max !== undefined ? (
          <button type="button" disabled={disabled} onClick={() => onChange(toDecimalString(max, token.decimals))} className="num rounded text-muted underline-offset-4 hover:text-fg hover:underline">
            {maxLabel}: {formatAmount(max, token.decimals)} {token.symbol}
          </button>
        ) : null}
      </div>
      <div className={cx("mt-2 flex h-16 items-center gap-3 rounded-control border bg-bg px-4 focus-within:border-fg", showError ? "border-danger" : "border-line-strong")}>
        <input
          id={id}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          placeholder="0"
          disabled={disabled}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          aria-invalid={showError}
          aria-describedby={showError ? `${id}-error` : undefined}
          className="num h-full w-full min-w-0 bg-transparent text-2xl font-semibold tracking-tight outline-none placeholder:text-faint"
        />
        <span className="shrink-0 text-sm font-medium text-muted">{token.symbol}</span>
      </div>
      {showError && !parsed.ok ? (
        <p id={`${id}-error`} className="mt-1.5 text-sm text-danger">
          {parseErrorMessage(parsed.error, token.decimals, token.symbol)}
        </p>
      ) : null}
    </div>
  );
}
