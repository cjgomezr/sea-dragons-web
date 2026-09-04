import type { MockupScreen, Theme } from "./catalog.ts";

export function buildFileName(
  entry: Pick<MockupScreen, "screen" | "platform">,
  theme: Theme,
): string {
  const platformPrefix = entry.platform === "mobile" ? "mobile-" : "";
  return `${platformPrefix}${entry.screen}-${theme}.png`;
}
