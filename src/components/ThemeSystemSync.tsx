"use client";

import { useEffect } from "react";
import {
  applyStoredThemePreference,
  readStoredThemePreference,
  subscribeToSystemScheme,
} from "@/lib/theme-preference";

// ThemeScript resolves `system` once, before hydration. This keeps it in step
// when the operating system switches while the page is open; an explicit light
// or dark choice is left alone.
function followSystemScheme(): void {
  if (readStoredThemePreference() === "system") {
    applyStoredThemePreference();
  }
}

export function ThemeSystemSync(): null {
  useEffect(() => subscribeToSystemScheme(followSystemScheme), []);
  return null;
}
