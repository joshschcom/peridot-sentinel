"use client";
import { useEffect, useState } from "react";
import { IconMoon, IconSun } from "@/components/ui/icons";

type Theme = "light" | "dark";

function currentTheme(): Theme {
  const stored = document.documentElement.dataset.theme;
  if (stored === "light" || stored === "dark") return stored;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/** Persists an explicit choice in localStorage; until then the page follows the system preference. */
export function ThemeToggle({ className = "" }: { className?: string }) {
  const [theme, setTheme] = useState<Theme | null>(null);

  useEffect(() => {
    setTheme(currentTheme());
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => setTheme(currentTheme());
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  const toggle = () => {
    const next: Theme = currentTheme() === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem("peridot-theme", next);
    } catch {
      // Storage can be unavailable (private mode); the choice then lasts for this page only.
    }
    setTheme(next);
  };

  const label = theme === null ? "Toggle theme" : `Switch to ${theme === "dark" ? "light" : "dark"} theme`;
  return (
    <button type="button" onClick={toggle} aria-label={label} title={label} className={`grid size-10 shrink-0 place-items-center rounded-full text-muted hover:bg-raised hover:text-fg ${className}`}>
      {theme === "dark" ? <IconSun size={18} /> : <IconMoon size={18} />}
    </button>
  );
}
