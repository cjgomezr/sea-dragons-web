"use client";

import { useSyncExternalStore } from "react";
import type { Locale } from "@/lib/i18n/locale";
import { createTranslator } from "@/lib/i18n/translator";
import { type Theme, nextTheme } from "@/lib/theme";
import {
  THEME_CHANGE_EVENT,
  chooseThemePreference,
  readAppliedTheme,
  subscribeToSystemScheme,
} from "@/lib/theme-preference";

// Under `system` the painted theme also moves when the operating system does.
function subscribe(onStoreChange: () => void): () => void {
  window.addEventListener(THEME_CHANGE_EVENT, onStoreChange);
  window.addEventListener("storage", onStoreChange);
  const unsubscribeFromSystem = subscribeToSystemScheme(onStoreChange);
  return () => {
    window.removeEventListener(THEME_CHANGE_EVENT, onStoreChange);
    window.removeEventListener("storage", onStoreChange);
    unsubscribeFromSystem();
  };
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
    readAppliedTheme,
    readServerTheme,
  );
  const isDark = theme === "dark";

  function handleToggle(): void {
    chooseThemePreference(nextTheme(theme));
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
