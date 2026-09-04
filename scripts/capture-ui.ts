import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Browser } from "@playwright/test";
import { decodePng, isUniformImage } from "./mockups/png.ts";
import {
  THEMES,
  VIEWPORTS,
  buildCaptureName,
  type Theme,
  type Viewport,
} from "./ui-review/matrix.ts";
import { parseCapturePath } from "./ui-review/cli.ts";
import { withDevServer } from "./ui-review/server.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_OUTPUT_DIR = path.join(HERE, "..", ".factory", "ui-screenshots");

export interface CaptureUiOptions {
  readonly outputDir?: string;
  /** Ruta de la app a capturar. Por defecto la portada. */
  readonly capturePath?: string;
}

/**
 * Captura la matriz completa de viewports por temas en una sola invocación,
 * con el dev server arrancado y apagado dentro de este mismo proceso.
 */
export async function captureUi(options: CaptureUiOptions = {}): Promise<string[]> {
  const outputDir = options.outputDir ?? DEFAULT_OUTPUT_DIR;
  const capturePath = options.capturePath ?? "/";

  return withDevServer(async (appUrl) => {
    await mkdir(outputDir, { recursive: true });
    const browser = await chromium.launch();

    try {
      const written: string[] = [];
      for (const viewport of VIEWPORTS) {
        const byTheme = await captureThemes(browser, new URL(capturePath, appUrl).href, viewport);
        assertThemesDiffer(viewport, byTheme);

        for (const [theme, buffer] of byTheme) {
          const fileName = buildCaptureName(viewport, theme);
          await writeFile(path.join(outputDir, fileName), buffer);
          written.push(fileName);
        }
      }
      await removeOrphanCaptures(outputDir, written);
      return written;
    } finally {
      await browser.close();
    }
  });
}

async function captureThemes(
  browser: Browser,
  url: string,
  viewport: Viewport,
): Promise<Map<Theme, Buffer>> {
  const byTheme = new Map<Theme, Buffer>();

  for (const theme of THEMES) {
    // colorScheme, no localStorage: cada proyecto persiste su tema a su
    // manera, pero todos responden a la preferencia del sistema.
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      colorScheme: theme,
    });

    try {
      const page = await context.newPage();
      await page.goto(url);
      await page.evaluate(async () => {
        await document.fonts.ready;
      });
      const buffer = await page.screenshot({ fullPage: true });
      assertNotBlank(buffer, buildCaptureName(viewport, theme));
      byTheme.set(theme, buffer);
    } finally {
      await context.close();
    }
  }

  return byTheme;
}

// Un PNG de una corrida anterior con otro nombre (otro viewport, otro tema)
// seguiría ahí, y el revisor lo leería como si fuera de esta corrida.
async function removeOrphanCaptures(
  outputDir: string,
  written: readonly string[],
): Promise<void> {
  const expected = new Set(written);
  const existing = await readdir(outputDir);

  await Promise.all(
    existing
      .filter((fileName) => fileName.endsWith(".png") && !expected.has(fileName))
      .map((fileName) => rm(path.join(outputDir, fileName))),
  );
}

function assertNotBlank(buffer: Buffer, fileName: string): void {
  if (isUniformImage(decodePng(buffer))) {
    throw new Error(
      `La captura de "${fileName}" salió en blanco (contenido uniforme). La aplicación no pintó nada.`,
    );
  }
}

// Dos capturas idénticas significan que el tema no llegó a aplicarse, y un
// revisor que compare la misma imagen dos veces aprueba lo que nunca vio.
function assertThemesDiffer(viewport: Viewport, byTheme: Map<Theme, Buffer>): void {
  const [light, dark] = [byTheme.get("light"), byTheme.get("dark")];
  if (light && dark && light.equals(dark)) {
    throw new Error(
      `Las capturas de ${viewport.name} en claro y en oscuro son idénticas: el tema no se aplicó.`,
    );
  }
}

async function main(): Promise<void> {
  const files = await captureUi({ capturePath: parseCapturePath(process.argv.slice(2)) });
  console.log(`${files.length} capturas en ${path.relative(process.cwd(), DEFAULT_OUTPUT_DIR)}:`);
  for (const file of files) {
    console.log(`  ${file}`);
  }
}

const isMain =
  process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  main().catch((error: unknown) => {
    // Un argumento mal escrito no merece un stack trace: merece la frase que
    // dice qué se escribió mal.
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
