"use client";
import { type ReactNode, useEffect, useRef } from "react";
import { cx } from "./core";
import { IconX } from "./icons";

/**
 * Action sheet: bottom sheet on phones, centred dialog from `sm` up.
 * Built on <dialog> so focus trapping, Escape and the backdrop are native.
 */
export function Sheet({ open, onClose, title, children, wide = false }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(event) => {
        if (event.target === ref.current) onClose();
      }}
      className={cx(
        "sheet-in m-0 mt-auto max-h-[92dvh] w-full max-w-none overflow-y-auto rounded-t-3xl border border-line bg-surface p-0 sm:m-auto sm:rounded-3xl",
        wide ? "sm:max-w-xl" : "sm:max-w-md",
      )}
    >
      {open ? (
        <div className="pb-safe">
          <div className="sticky top-0 z-10 flex items-center justify-between gap-4 border-b border-line bg-surface px-5 py-3.5">
            <h2 className="text-base font-semibold tracking-tight">{title}</h2>
            <button type="button" onClick={onClose} aria-label="Close" className="-mr-2 grid size-10 place-items-center rounded-full text-muted hover:bg-raised hover:text-fg">
              <IconX size={18} />
            </button>
          </div>
          <div className="p-5">{children}</div>
        </div>
      ) : null}
    </dialog>
  );
}
