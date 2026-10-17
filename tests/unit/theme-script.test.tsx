import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ThemeScript } from "@/components/ThemeScript";
import { THEME_STORAGE_KEY } from "@/lib/theme";
import { stubColorScheme } from "../support/color-scheme";

// Runs the exact inline script the server sends, the way the browser runs it
// before hydration. The reload proof in a real browser is tests/theme.spec.ts.
function runThemeScript(): void {
  const markup = renderToStaticMarkup(<ThemeScript />);
  const body = markup.replace(/^<script>/, "").replace(/<\/script>$/, "");
  new Function(body)();
}

describe("ThemeScript", () => {
  beforeEach(() => {
    window.localStorage.clear();
    delete document.documentElement.dataset.theme;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("follows a dark operating system when the preference is system", () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "system");
    stubColorScheme(true);

    runThemeScript();

    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("follows a light operating system when the preference is system", () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "system");
    stubColorScheme(false);

    runThemeScript();

    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("treats an empty preference as system", () => {
    stubColorScheme(true);

    runThemeScript();

    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("respects a stored light theme over a dark operating system", () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "light");
    stubColorScheme(true);

    runThemeScript();

    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("respects a stored dark theme over a light operating system", () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "dark");
    stubColorScheme(false);

    runThemeScript();

    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("follows the operating system when storage is blocked", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("The operation is insecure.", "SecurityError");
    });
    stubColorScheme(true);

    runThemeScript();

    expect(document.documentElement.dataset.theme).toBe("dark");
  });
});
