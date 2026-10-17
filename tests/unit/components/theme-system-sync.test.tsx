import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ThemeSystemSync } from "@/components/ThemeSystemSync";
import { THEME_STORAGE_KEY } from "@/lib/theme";
import { stubColorScheme } from "../../support/color-scheme";

describe("ThemeSystemSync", () => {
  beforeEach(() => {
    window.localStorage.clear();
    delete document.documentElement.dataset.theme;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("follows the operating system to dark while the preference is system", () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "system");
    document.documentElement.dataset.theme = "light";
    const colorScheme = stubColorScheme(false);
    render(<ThemeSystemSync />);

    act(() => colorScheme.setPrefersDark(true));

    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("keeps an explicit dark theme when the operating system turns light", () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "dark");
    document.documentElement.dataset.theme = "dark";
    const colorScheme = stubColorScheme(true);
    render(<ThemeSystemSync />);

    act(() => colorScheme.setPrefersDark(false));

    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("keeps an explicit light theme when the operating system turns dark", () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "light");
    document.documentElement.dataset.theme = "light";
    const colorScheme = stubColorScheme(false);
    render(<ThemeSystemSync />);

    act(() => colorScheme.setPrefersDark(true));

    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("stops listening to the operating system once unmounted", () => {
    const colorScheme = stubColorScheme(false);
    const { unmount } = render(<ThemeSystemSync />);

    unmount();

    expect(colorScheme.listenerCount()).toBe(0);
  });
});
