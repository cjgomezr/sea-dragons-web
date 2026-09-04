export type Theme = "light" | "dark";

export interface Viewport {
  readonly name: string;
  readonly width: number;
  readonly height: number;
}

export interface Capture {
  readonly viewport: Viewport;
  readonly theme: Theme;
  readonly fileName: string;
}

// Los mismos tres anchos que vigila tests/ui.spec.ts: un revisor que mirara
// otros estaría juzgando una página que la suite visual no protege.
export const VIEWPORTS: readonly Viewport[] = [
  { name: "mobile", width: 375, height: 812 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1440, height: 900 },
];

export const THEMES: readonly Theme[] = ["light", "dark"];

export function buildCaptureName(viewport: Pick<Viewport, "name">, theme: Theme): string {
  return `ui-${viewport.name}-${theme}.png`;
}

export const CAPTURE_MATRIX: readonly Capture[] = VIEWPORTS.flatMap((viewport) =>
  THEMES.map((theme) => ({
    viewport,
    theme,
    fileName: buildCaptureName(viewport, theme),
  })),
);
