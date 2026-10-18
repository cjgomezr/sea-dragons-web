import {
  DARK_SCHEME_QUERY,
  THEME_STORAGE_KEY,
  type Theme,
  type ThemePreference,
  readThemePreference,
  resolveTheme,
} from "@/lib/theme";

// Same-tab writes do not fire `storage`, so a choice announces its own change.
export const THEME_CHANGE_EVENT = "seadragons:themechange";

// A browser that denies storage (Safari private mode) still deserves the theme
// it was just asked for, for as long as the page stays open. This is the only
// place that choice can live.
let unsavedPreference: ThemePreference | null = null;

function prefersDarkScheme(): boolean {
  return window.matchMedia(DARK_SCHEME_QUERY).matches;
}

// Denied storage is a documented browser state, not a failure: it means the
// visitor has no saved choice, which is `system`.
function readStorage(): string | null {
  try {
    return window.localStorage.getItem(THEME_STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeStorage(preference: ThemePreference): boolean {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, preference);
    return true;
  } catch {
    return false;
  }
}

export function readStoredThemePreference(): ThemePreference {
  return unsavedPreference ?? readThemePreference(readStorage());
}

// Reads storage, never `data-theme`. Deriving the theme from the attribute this
// module also writes creates a feedback loop that latches it to whatever the
// hydration render happened to guess.
export function readAppliedTheme(): Theme {
  return resolveTheme(readStoredThemePreference(), prefersDarkScheme());
}

export function applyStoredThemePreference(): void {
  document.documentElement.dataset.theme = readAppliedTheme();
}

export function chooseThemePreference(preference: ThemePreference): void {
  unsavedPreference = writeStorage(preference) ? null : preference;
  applyStoredThemePreference();
  window.dispatchEvent(new Event(THEME_CHANGE_EVENT));
}

export function subscribeToSystemScheme(onChange: () => void): () => void {
  const query = window.matchMedia(DARK_SCHEME_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

// Under `system` the painted theme also moves when the operating system does.
export function subscribeToThemeChanges(onChange: () => void): () => void {
  window.addEventListener(THEME_CHANGE_EVENT, onChange);
  window.addEventListener("storage", onChange);
  const unsubscribeFromSystem = subscribeToSystemScheme(onChange);
  return () => {
    window.removeEventListener(THEME_CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onChange);
    unsubscribeFromSystem();
  };
}
