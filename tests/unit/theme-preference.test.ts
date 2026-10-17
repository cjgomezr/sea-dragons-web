import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { THEME_STORAGE_KEY } from "@/lib/theme";
import { stubColorScheme } from "../support/color-scheme";

type ThemePreferenceModule = typeof import("@/lib/theme-preference");

// The module remembers a choice it could not save, so every test starts from
// a fresh copy instead of inheriting the previous test's session.
async function loadThemePreference(): Promise<ThemePreferenceModule> {
  vi.resetModules();
  return import("@/lib/theme-preference");
}

function blockStorage(): void {
  const blocked = (): never => {
    throw new DOMException("The operation is insecure.", "SecurityError");
  };
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(blocked);
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(blocked);
}

describe("theme preference", () => {
  beforeEach(() => {
    window.localStorage.clear();
    delete document.documentElement.dataset.theme;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  describe("readStoredThemePreference", () => {
    it("is system when nothing is stored", async () => {
      const { readStoredThemePreference } = await loadThemePreference();

      expect(readStoredThemePreference()).toBe("system");
    });

    it("keeps the theme someone stored before system existed", async () => {
      window.localStorage.setItem(THEME_STORAGE_KEY, "dark");
      const { readStoredThemePreference } = await loadThemePreference();

      expect(readStoredThemePreference()).toBe("dark");
    });

    it("is system when storage cannot be read", async () => {
      blockStorage();
      const { readStoredThemePreference } = await loadThemePreference();

      expect(readStoredThemePreference()).toBe("system");
    });
  });

  describe("chooseThemePreference", () => {
    it("saves the chosen preference", async () => {
      const { chooseThemePreference } = await loadThemePreference();

      chooseThemePreference("system");

      expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("system");
    });

    it("applies an explicit theme to the document at once", async () => {
      const { chooseThemePreference } = await loadThemePreference();

      chooseThemePreference("dark");

      expect(document.documentElement.dataset.theme).toBe("dark");
    });

    it("applies the operating system theme when system is chosen", async () => {
      stubColorScheme(true);
      const { chooseThemePreference } = await loadThemePreference();

      chooseThemePreference("system");

      expect(document.documentElement.dataset.theme).toBe("dark");
    });

    it("announces the change with the theme change event", async () => {
      const { chooseThemePreference, THEME_CHANGE_EVENT } =
        await loadThemePreference();
      const onChange = vi.fn();
      window.addEventListener(THEME_CHANGE_EVENT, onChange);

      chooseThemePreference("light");
      window.removeEventListener(THEME_CHANGE_EVENT, onChange);

      expect(THEME_CHANGE_EVENT).toBe("seadragons:themechange");
      expect(onChange).toHaveBeenCalledOnce();
    });

    it("applies the choice without throwing when storage is blocked", async () => {
      blockStorage();
      const { chooseThemePreference } = await loadThemePreference();

      expect(() => chooseThemePreference("dark")).not.toThrow();
      expect(document.documentElement.dataset.theme).toBe("dark");
    });

    it("remembers an unsaved choice for the rest of the session", async () => {
      blockStorage();
      const { chooseThemePreference, readStoredThemePreference } =
        await loadThemePreference();

      chooseThemePreference("dark");

      expect(readStoredThemePreference()).toBe("dark");
    });
  });
});
