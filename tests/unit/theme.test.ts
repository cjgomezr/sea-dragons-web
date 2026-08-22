import { describe, expect, it } from "vitest";
import { nextTheme, resolveInitialTheme } from "@/lib/theme";

describe("nextTheme", () => {
  it("switches light to dark", () => {
    expect(nextTheme("light")).toBe("dark");
  });

  it("switches dark to light", () => {
    expect(nextTheme("dark")).toBe("light");
  });
});

describe("resolveInitialTheme", () => {
  it("uses the stored preference over the operating system preference", () => {
    expect(resolveInitialTheme("light", true)).toBe("light");
  });

  it("falls back to dark when nothing is stored and the OS prefers dark", () => {
    expect(resolveInitialTheme(null, true)).toBe("dark");
  });

  it("falls back to light when nothing is stored and the OS prefers light", () => {
    expect(resolveInitialTheme(null, false)).toBe("light");
  });

  it("ignores a stored value that is not a known theme", () => {
    expect(resolveInitialTheme("purple", true)).toBe("dark");
  });
});
