import { useState } from "react";
import { MoonIcon, SunIcon } from "./Icons";

type Theme = "light" | "dark";

function currentTheme(): Theme {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

export function ThemeToggle({ withLabel = false }: { withLabel?: boolean }) {
  const [theme, setTheme] = useState<Theme>(currentTheme);
  const nextLabel = theme === "light" ? "切换到暗色模式" : "切换到亮色模式";

  const toggle = () => {
    const next = theme === "light" ? "dark" : "light";
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem("podium-theme", next);
    } catch {
      // Theme persistence is optional in restricted browser contexts.
    }
    setTheme(next);
  };

  return (
    <button
      type="button"
      className={withLabel ? "nav-link" : "icon-btn theme-toggle"}
      onClick={toggle}
      aria-label={nextLabel}
      title={nextLabel}
    >
      <span className="theme-icon-wrap" aria-hidden="true">
        <SunIcon className="icon theme-icon theme-icon-sun" />
        <MoonIcon className="icon theme-icon theme-icon-moon" />
      </span>
      {withLabel && <span>{nextLabel}</span>}
    </button>
  );
}
