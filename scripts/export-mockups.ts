import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium, type Page } from "@playwright/test";
import { applyScreenAction } from "./mockups/capture.ts";
import {
  MOCKUP_SCREENS,
  THEMES,
  type Platform,
  type Theme,
} from "./mockups/catalog.ts";
import { buildFileName } from "./mockups/filename.ts";
import { decodePng, isUniformImage } from "./mockups/png.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_PROTOTYPE_PATH = path.join(
  HERE,
  "..",
  "docs",
  "Seadragons Platform.dc.html",
);
const DEFAULT_OUTPUT_DIR = path.join(HERE, "..", "docs", "mockups");

const WEB_VIEWPORT = { width: 1320, height: 900 };
const MOBILE_VIEWPORT = { width: 500, height: 900 };
// React serializa el atributo style con un espacio tras los dos puntos
// ("max-width: 1320px"), distinto del string sin espacios de la plantilla.
const WEB_CONTAINER_SELECTOR = '[style*="max-width: 1320px"]';
const MOBILE_FRAME_SELECTOR = '[style*="width: 390px"]';
const AUTH_OVERLAY_SELECTOR = '[style*="z-index: 90"]';
const APP_READY_TIMEOUT_MS = 20_000;

export interface ExportMockupsOptions {
  readonly outputDir?: string;
  readonly prototypePath?: string;
  /** Solo para tests: bloquea peticiones de red que calcen con este patrón glob. */
  readonly blockUrlPattern?: string;
}

export async function exportMockups(
  options: ExportMockupsOptions = {},
): Promise<string[]> {
  const outputDir = options.outputDir ?? DEFAULT_OUTPUT_DIR;
  const prototypePath = options.prototypePath ?? DEFAULT_PROTOTYPE_PATH;
  await mkdir(outputDir, { recursive: true });

  const browser = await chromium.launch();
  const failedRequestUrls: string[] = [];
  const writtenFiles: string[] = [];

  try {
    const page = await browser.newPage({ viewport: WEB_VIEWPORT });
    page.on("requestfailed", (request) =>
      failedRequestUrls.push(request.url()),
    );
    if (options.blockUrlPattern) {
      await page.route(options.blockUrlPattern, (route) => route.abort());
    }

    await page.goto(pathToFileURL(prototypePath).href);
    await waitForAppReady(page, failedRequestUrls);

    for (const platform of ["web", "mobile"] as const) {
      await page.setViewportSize(
        platform === "web" ? WEB_VIEWPORT : MOBILE_VIEWPORT,
      );
      await setPlatform(page, platform);

      for (const theme of THEMES) {
        await setTheme(page, theme);

        for (const entry of MOCKUP_SCREENS.filter(
          (s) => s.platform === platform,
        )) {
          await applyScreenAction(page, entry.action);

          const fileName = buildFileName(entry, theme);
          const buffer = await captureScreen(page, entry);
          assertNotBlank(buffer, fileName);
          await writeFile(path.join(outputDir, fileName), buffer);
          writtenFiles.push(fileName);

          if (entry.action.type === "web-sign-out") {
            await page.getByRole("button", { name: "← Back to app" }).click();
          }
        }
      }
    }
  } finally {
    await browser.close();
  }

  await removeOrphanFiles(outputDir, writtenFiles);
  return writtenFiles;
}

async function setPlatform(page: Page, platform: Platform): Promise<void> {
  const label = platform === "web" ? "Web" : "Mobile";
  await page.getByRole("button", { name: label, exact: true }).click();
}

async function setTheme(page: Page, theme: Theme): Promise<void> {
  const label = theme === "light" ? "Light" : "Dark";
  await page.getByRole("button", { name: label, exact: true }).click();
}

async function captureScreen(
  page: Page,
  entry: (typeof MOCKUP_SCREENS)[number],
): Promise<Buffer> {
  if (entry.platform === "mobile") {
    return page.locator(MOBILE_FRAME_SELECTOR).screenshot();
  }
  if (entry.action.type === "web-sign-out") {
    return page.locator(AUTH_OVERLAY_SELECTOR).screenshot();
  }
  return page.locator(WEB_CONTAINER_SELECTOR).screenshot();
}

function assertNotBlank(buffer: Buffer, fileName: string): void {
  const decoded = decodePng(buffer);
  if (isUniformImage(decoded)) {
    throw new Error(
      `La captura de "${fileName}" salió en blanco (contenido uniforme). El prototipo no cargó su contenido real.`,
    );
  }
}

async function waitForAppReady(
  page: Page,
  failedRequestUrls: string[],
): Promise<void> {
  try {
    await page
      .getByRole("button", { name: "Dashboard", exact: true })
      .waitFor({ state: "visible", timeout: APP_READY_TIMEOUT_MS });
  } catch {
    const resources =
      failedRequestUrls.length > 0
        ? failedRequestUrls.join(", ")
        : "recursos externos del prototipo (revisa la conexión a internet)";
    throw new Error(
      `El prototipo no cargó. No se pudieron obtener: ${resources}`,
    );
  }
}

async function removeOrphanFiles(
  outputDir: string,
  expectedFileNames: string[],
): Promise<void> {
  const expected = new Set(expectedFileNames);
  const existingFiles = await readdir(outputDir);
  await Promise.all(
    existingFiles
      .filter(
        (fileName) => fileName.endsWith(".png") && !expected.has(fileName),
      )
      .map((fileName) => rm(path.join(outputDir, fileName))),
  );
}

const isMain =
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  exportMockups()
    .then((files) => {
      console.log(`Exportadas ${files.length} imágenes a docs/mockups/`);
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
