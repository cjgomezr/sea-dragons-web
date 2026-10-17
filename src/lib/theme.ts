export const THEME_STORAGE_KEY = "seadragons-theme";

/** The theme painted on the page. */
export type Theme = "light" | "dark";

/** What the visitor chose: a fixed theme, or whatever the system prefers. */
export type ThemePreference = Theme | "system";

export const DARK_SCHEME_QUERY = "(prefers-color-scheme: dark)";

function isThemePreference(value: unknown): value is ThemePreference {
  return value === "light" || value === "dark" || value === "system";
}

export function nextTheme(current: Theme): Theme {
  return current === "light" ? "dark" : "light";
}

/**
 * RF-9 (E26): a visitor who never chose, or whose stored value is unreadable,
 * follows the system. The light and dark values stored before `system` existed
 * keep meaning what they meant.
 */
export function readThemePreference(stored: string | null): ThemePreference {
  return isThemePreference(stored) ? stored : "system";
}

/** FR-079: an explicit choice always wins over the operating system. */
export function resolveTheme(
  preference: ThemePreference,
  prefersDark: boolean,
): Theme {
  if (preference !== "system") {
    return preference;
  }
  return prefersDark ? "dark" : "light";
}
