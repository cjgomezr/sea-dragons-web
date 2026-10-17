import { describe, expect, it } from "vitest";
import { nextTheme, readThemePreference, resolveTheme } from "@/lib/theme";

describe("nextTheme", () => {
  it("switches light to dark", () => {
    expect(nextTheme("light")).toBe("dark");
  });

  it("switches dark to light", () => {
    expect(nextTheme("dark")).toBe("light");
  });
});

describe("readThemePreference", () => {
  it("is system when nothing is stored", () => {
    expect(readThemePreference(null)).toBe("system");
  });

  it("is system when the stored value is not a known preference", () => {
    expect(readThemePreference("purple")).toBe("system");
  });

  it("keeps a stored light theme", () => {
    expect(readThemePreference("light")).toBe("light");
  });

  it("keeps a stored dark theme", () => {
    expect(readThemePreference("dark")).toBe("dark");
  });

  it("keeps a stored system preference", () => {
    expect(readThemePreference("system")).toBe("system");
  });
});

describe("resolveTheme", () => {
  it("follows a dark operating system when the preference is system", () => {
    expect(resolveTheme("system", true)).toBe("dark");
  });

  it("follows a light operating system when the preference is system", () => {
    expect(resolveTheme("system", false)).toBe("light");
  });

  it("uses an explicit light preference over a dark operating system", () => {
    expect(resolveTheme("light", true)).toBe("light");
  });

  it("uses an explicit dark preference over a light operating system", () => {
    expect(resolveTheme("dark", false)).toBe("dark");
  });
});
