import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { type Maybe } from "@/lib/maybe";

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

/* ---------- Button ---------- */

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
type ButtonSize = "sm" | "md" | "lg";

const BUTTON_BASE =
  "inline-flex items-center justify-center gap-2 rounded-full font-medium whitespace-nowrap transition-colors select-none disabled:opacity-45 disabled:pointer-events-none";
const BUTTON_VARIANT: Record<ButtonVariant, string> = {
  primary: "bg-inverse text-on-inverse hover:opacity-90",
  secondary: "border border-line-strong bg-transparent text-fg hover:bg-raised",
  ghost: "text-fg hover:bg-raised",
  danger: "border border-danger text-danger hover:bg-danger-soft",
};
const BUTTON_SIZE: Record<ButtonSize, string> = {
  sm: "h-9 px-3.5 text-sm",
  md: "h-11 px-5 text-[0.9375rem]",
  lg: "h-13 px-7 text-base",
};

export function buttonClass(variant: ButtonVariant = "primary", size: ButtonSize = "md", className?: string): string {
  return cx(BUTTON_BASE, BUTTON_VARIANT[variant], BUTTON_SIZE[size], className);
}

export function Button({ variant, size, className, type = "button", ...props }: ComponentProps<"button"> & { variant?: ButtonVariant; size?: ButtonSize }) {
  return <button type={type} className={buttonClass(variant, size, className)} {...props} />;
}

export function ButtonLink({ variant, size, className, ...props }: ComponentProps<typeof Link> & { variant?: ButtonVariant; size?: ButtonSize }) {
  return <Link className={buttonClass(variant, size, className)} {...props} />;
}

/* ---------- Card ---------- */

export function Card({ className, as = "div", ...props }: ComponentProps<"div"> & { as?: "div" | "section" | "article" | "li" }) {
  const Tag = as as "div";
  return <Tag className={cx("rounded-card border border-line bg-surface", className)} {...props} />;
}

export function CardHeader({ title, action, description, eyebrow }: { title: ReactNode; description?: ReactNode; action?: ReactNode; eyebrow?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 px-5 pt-5 sm:px-6 sm:pt-6">
      <div className="min-w-0">
        {eyebrow ? <div className="eyebrow mb-1.5">{eyebrow}</div> : null}
        <h2 className="text-base font-semibold tracking-tight">{title}</h2>
        {description ? <p className="mt-1 text-sm text-muted">{description}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

/* ---------- Badge ---------- */

export type Tone = "neutral" | "success" | "danger" | "warning" | "solid" | "outline";
const TONE: Record<Tone, string> = {
  neutral: "bg-raised text-muted",
  outline: "border border-line-strong text-muted",
  solid: "bg-inverse text-on-inverse",
  success: "bg-success-soft text-success",
  danger: "bg-danger-soft text-danger",
  warning: "bg-warning-soft text-warning",
};

/** `wrap`: for labels that can be longer than a phone column (state sentences, provenance labels). */
export function Badge({ tone = "neutral", className, children, wrap = false }: { tone?: Tone; className?: string; children: ReactNode; wrap?: boolean }) {
  return <span className={cx("inline-flex items-center gap-1 px-2.5 text-xs font-medium", wrap ? "min-h-6 max-w-full rounded-xl py-0.5 text-left" : "h-6 rounded-full whitespace-nowrap", TONE[tone], className)}>{children}</span>;
}

/** Marks a number or record as example data. Rendered next to every fixture-backed figure group. */
export function ExampleTag({ className, label = "Example" }: { className?: string; label?: string }) {
  return (
    <span className={cx("inline-flex h-5 items-center rounded border border-dashed border-warning px-1.5 text-[0.6875rem] font-medium tracking-wide text-warning uppercase", className)}>
      {label}
    </span>
  );
}

/* ---------- Stat ---------- */

export function Stat({ label, value, sub, className }: { label: ReactNode; value: ReactNode; sub?: ReactNode; className?: string }) {
  return (
    <div className={cx("min-w-0", className)}>
      <div className="text-[0.8125rem] text-muted">{label}</div>
      <div className="num mt-1 text-xl leading-tight font-semibold tracking-tight break-words sm:text-2xl">{value}</div>
      {sub ? <div className="num mt-0.5 text-[0.8125rem] text-faint">{sub}</div> : null}
    </div>
  );
}

/** Renders a Maybe: the value, or an explicit "Unavailable" that is visibly not a zero. */
export function Value<T>({ of, children, short = false }: { of: Maybe<T>; children: (value: T) => ReactNode; short?: boolean }) {
  if (of.status === "ok") return <>{children(of.value)}</>;
  return (
    <span className="font-normal text-faint" title={of.reason}>
      {short ? "—" : "Unavailable"}
    </span>
  );
}

/* ---------- Layout bits ---------- */

export function PageHeader({ title, description, actions, eyebrow }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; eyebrow?: ReactNode }) {
  return (
    <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow ? <div className="eyebrow mb-2">{eyebrow}</div> : null}
        <h1 className="title">{title}</h1>
        {description ? <p className="mt-2 max-w-2xl text-[0.9375rem] text-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

/** `stack` puts the value under the label on phones: for rows whose label or value is a sentence, not a word. */
export function DefinitionRow({ label, children, mono = false, stack = false }: { label: ReactNode; children: ReactNode; mono?: boolean; stack?: boolean }) {
  return (
    <div className={cx("py-2.5 text-sm", stack ? "flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4" : "flex items-baseline justify-between gap-4")}>
      <dt className={cx("text-muted", stack ? "sm:shrink-0" : "shrink-0")}>{label}</dt>
      <dd className={cx("num min-w-0 break-words", stack ? "sm:text-right" : "text-right", mono && "font-mono text-[0.8125rem]")}>{children}</dd>
    </div>
  );
}

export function Notice({ tone = "neutral", icon, title, children, className, ...rest }: { tone?: "neutral" | "warning" | "danger" | "success"; icon?: ReactNode; title?: ReactNode; children?: ReactNode; className?: string } & Omit<ComponentProps<"div">, "title" | "children" | "className">) {
  const toneClass = {
    neutral: "border-line bg-subtle text-fg",
    warning: "border-warning bg-warning-soft text-fg",
    danger: "border-danger bg-danger-soft text-fg",
    success: "border-success bg-success-soft text-fg",
  }[tone];
  const iconClass = { neutral: "text-muted", warning: "text-warning", danger: "text-danger", success: "text-success" }[tone];
  return (
    <div className={cx("flex gap-3 rounded-control border p-3.5 text-sm", toneClass, className)} {...rest}>
      {icon ? <div className={cx("mt-0.5 shrink-0", iconClass)}>{icon}</div> : null}
      <div className="min-w-0">
        {title ? <div className="font-medium">{title}</div> : null}
        {children ? <div className={cx("text-muted", title ? "mt-0.5" : "")}>{children}</div> : null}
      </div>
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden="true" className={cx("animate-pulse rounded-control bg-raised", className)} />;
}

export function EmptyState({ title, children, action, ...rest }: { title: ReactNode; children?: ReactNode; action?: ReactNode } & Omit<ComponentProps<"div">, "title" | "children">) {
  return (
    <div className="flex flex-col items-center rounded-card border border-dashed border-line-strong px-6 py-12 text-center" {...rest}>
      <h3 className="text-base font-semibold">{title}</h3>
      {children ? <p className="mt-1.5 max-w-md text-sm text-muted">{children}</p> : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

/** Advanced / raw details, collapsed by default so retail views stay calm. */
export function Advanced({ label = "Advanced details", children, className }: { label?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <details className={cx("group rounded-control border border-line", className)}>
      <summary className="flex min-h-11 items-center justify-between gap-3 px-3.5 text-sm font-medium text-muted hover:text-fg">
        <span>{label}</span>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="transition-transform group-open:rotate-180">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </summary>
      <div className="border-t border-line p-3.5 text-sm">{children}</div>
    </details>
  );
}

export function Mono({ children, className }: { children: ReactNode; className?: string }) {
  return <code className={cx("font-mono text-[0.8125rem] break-all", className)}>{children}</code>;
}
