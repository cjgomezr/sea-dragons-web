export const THEME_STORAGE_KEY = "seadragons-theme";

export type Theme = "light" | "dark";

function isTheme(value: unknown): value is Theme {
  return value === "light" || value === "dark";
}

export function nextTheme(current: Theme): Theme {
  return current === "light" ? "dark" : "light";
}

/**
 * FR-079: the persisted choice always wins. The operating system preference is
 * only the starting point for a visitor who has never picked one.
 */
export function resolveInitialTheme(
  stored: string | null,
  prefersDark: boolean,
): Theme {
  if (isTheme(stored)) {
    return stored;
  }
  return prefersDark ? "dark" : "light";
}
