import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { exportMockups } from "../../../scripts/export-mockups.ts";
import { MOCKUP_SCREENS, THEMES } from "../../../scripts/mockups/catalog.ts";
import { buildFileName } from "../../../scripts/mockups/filename.ts";
import { decodePng } from "../../../scripts/mockups/png.ts";
import { findMissingFiles } from "../../../scripts/mockups/verify.ts";

const EXPORT_TIMEOUT_MS = 180_000;
// tsconfig.json y CLAUDE.md son los que next dev reescribe al arrancar
// (véase scripts/ui-review/tree-guard.ts); esta corrida no arranca ningún dev
// server, pero lo confirma en vez de asumirlo.
const FILES_NEXT_DEV_REWRITES = ["tsconfig.json", "CLAUDE.md"];

async function readGuardedFiles(): Promise<string[]> {
  return Promise.all(
    FILES_NEXT_DEV_REWRITES.map((filePath) => readFile(filePath, "utf8")),
  );
}

describe("exportMockups contra el prototipo real", () => {
  let outputDir: string;

  afterEach(async () => {
    if (outputDir) {
      await rm(outputDir, { recursive: true, force: true });
    }
  });

  it(
    "exporta las 28 imágenes con las dimensiones mínimas y limpia huérfanos de corridas previas",
    async () => {
      outputDir = await mkdtemp(path.join(tmpdir(), "seadragons-mockups-"));
      await writeFile(
        path.join(outputDir, "huerfano-de-otra-corrida.png"),
        Buffer.from([0]),
      );
      const guardedFilesBefore = await readGuardedFiles();

      const written = await exportMockups({ outputDir });
      const expectedFiles = MOCKUP_SCREENS.flatMap((entry) =>
        THEMES.map((theme) => buildFileName(entry, theme)),
      );

      expect(findMissingFiles(expectedFiles, written)).toEqual([]);
      expect(await readGuardedFiles()).toEqual(guardedFilesBefore);

      const filesOnDisk = await readdir(outputDir);
      expect(new Set(filesOnDisk)).toEqual(new Set(expectedFiles));
      expect(filesOnDisk).not.toContain("huerfano-de-otra-corrida.png");

      for (const entry of MOCKUP_SCREENS) {
        for (const theme of THEMES) {
          const fileName = buildFileName(entry, theme);
          const buffer = await readFile(path.join(outputDir, fileName));
          const decoded = decodePng(buffer);
          const minWidth = entry.platform === "web" ? 1320 : 390;
          expect(
            decoded.width,
            `${fileName} debería medir al menos ${minWidth}px`,
          ).toBeGreaterThanOrEqual(minWidth);
        }
      }
    },
    EXPORT_TIMEOUT_MS,
  );

  it("falla con un mensaje que nombra el recurso que no pudo cargar cuando la red no responde", async () => {
    outputDir = await mkdtemp(path.join(tmpdir(), "seadragons-mockups-"));

    await expect(
      exportMockups({ outputDir, blockUrlPattern: "**/unpkg.com/**" }),
    ).rejects.toThrow(/unpkg\.com/);
  }, 60_000);
});
