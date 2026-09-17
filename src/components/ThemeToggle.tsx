"use client";

import { useSyncExternalStore } from "react";
import type { Locale } from "@/lib/i18n/locale";
import { createTranslator } from "@/lib/i18n/translator";
import {
  THEME_STORAGE_KEY,
  type Theme,
  nextTheme,
  resolveInitialTheme,
} from "@/lib/theme";

// Same-tab writes do not fire `storage`, so the toggle announces its own change.
const THEME_CHANGE_EVENT = "seadragons:themechange";

function subscribe(onStoreChange: () => void): () => void {
  window.addEventListener(THEME_CHANGE_EVENT, onStoreChange);
  window.addEventListener("storage", onStoreChange);
  return () => {
    window.removeEventListener(THEME_CHANGE_EVENT, onStoreChange);
    window.removeEventListener("storage", onStoreChange);
  };
}

// Reads storage, never `data-theme`. Deriving the snapshot from the attribute
// this component also writes creates a feedback loop that latches the theme to
// whatever the hydration render happened to guess.
function readStoredTheme(): Theme {
  return resolveInitialTheme(
    window.localStorage.getItem(THEME_STORAGE_KEY),
    window.matchMedia("(prefers-color-scheme: dark)").matches,
  );
}

// The server cannot know a visitor's stored choice. ThemeScript has already
// painted the right theme; this snapshot only drives the button's own label
// until the store is read after hydration.
function readServerTheme(): Theme {
  return "light";
}

export function ThemeToggle({ locale }: { locale: Locale }): React.JSX.Element {
  const translate = createTranslator(locale);
  const theme = useSyncExternalStore(
    subscribe,
    readStoredTheme,
    readServerTheme,
  );
  const isDark = theme === "dark";

  function handleToggle(): void {
    const updated = nextTheme(theme);
    window.localStorage.setItem(THEME_STORAGE_KEY, updated);
    document.documentElement.dataset.theme = updated;
    window.dispatchEvent(new Event(THEME_CHANGE_EVENT));
  }

  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={handleToggle}
      aria-pressed={isDark}
      aria-label={translate(
        isDark ? "themeToggle.switchToLight" : "themeToggle.switchToDark",
      )}
    >
      <span aria-hidden="true">{isDark ? "☀" : "☾"}</span>
    </button>
  );
}
