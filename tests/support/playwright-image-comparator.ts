import { createRequire } from "node:module";

export interface ComparisonTolerance {
  readonly threshold: number;
  readonly maxDiffPixels: number;
}

type ImageComparator = (
  actual: Buffer,
  expected: Buffer,
  options: ComparisonTolerance,
) => { readonly errorMessage: string } | null;

interface CoreBundle {
  readonly utils: {
    readonly getComparator: (mimeType: string) => ImageComparator;
  };
}

/**
 * El comparador con el que `toHaveScreenshot` decide si una captura cambió.
 * Es interno de Playwright y no trae tipos: se usa el suyo, y no un
 * `pixelmatch` propio, para que el test mida exactamente lo que mide la
 * visual. Si una versión nueva lo mueve, esto falla con un mensaje claro.
 */
function loadPlaywrightPngComparator(): ImageComparator {
  const coreBundle = createRequire(import.meta.url)(
    "playwright-core/lib/coreBundle",
  ) as Partial<CoreBundle>;
  if (typeof coreBundle.utils?.getComparator !== "function") {
    throw new Error(
      "playwright-core ya no expone utils.getComparator en lib/coreBundle",
    );
  }
  return coreBundle.utils.getComparator("image/png");
}

/** Si Playwright daría esta captura por distinta de su línea base. */
export function isVisualChange(
  expected: Buffer,
  actual: Buffer,
  tolerance: ComparisonTolerance,
): boolean {
  return loadPlaywrightPngComparator()(actual, expected, tolerance) !== null;
}
