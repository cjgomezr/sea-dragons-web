import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { captureUi } from "../../../scripts/capture-ui.ts";
import { CAPTURE_MATRIX } from "../../../scripts/ui-review/matrix.ts";
import { decodePng } from "../../../scripts/mockups/png.ts";

const CAPTURE_TIMEOUT_MS = 180_000;
const APP_URL = "http://localhost:3417";
const APP_PORT = 3417;
// next dev reescribe estos dos al arrancar: son el árbol de trabajo que este
// test no puede permitirse ensuciar.
const FILES_NEXT_DEV_REWRITES = ["tsconfig.json", "CLAUDE.md"];

async function readGuardedFiles(): Promise<string[]> {
  return Promise.all(
    FILES_NEXT_DEV_REWRITES.map((filePath) => readFile(filePath, "utf8")),
  );
}

async function respondsAt(url: string): Promise<boolean> {
  try {
    await fetch(url, { signal: AbortSignal.timeout(3000) });
    return true;
  } catch {
    return false;
  }
}

async function waitUntilResponds(url: string): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (await respondsAt(url)) {
      return;
    }
  }
  throw new Error(`El servidor intruso no llegó a responder en ${url}`);
}

describe("captureUi contra la aplicación real", () => {
  let outputDir = "";
  let intruder: ChildProcess | undefined;

  afterEach(async () => {
    if (outputDir) {
      await rm(outputDir, { recursive: true, force: true });
      outputDir = "";
    }
    if (intruder) {
      intruder.kill();
      intruder = undefined;
    }
  });

  it(
    "captura los tres viewports en ambos temas y deja el puerto libre",
    async () => {
      outputDir = await mkdtemp(path.join(tmpdir(), "seadragons-ui-"));
      await writeFile(
        path.join(outputDir, "ui-huerfana-de-otra-corrida.png"),
        Buffer.from([0]),
      );
      const guardedFilesBefore = await readGuardedFiles();

      const written = await captureUi({ outputDir });

      expect(new Set(written)).toEqual(
        new Set(CAPTURE_MATRIX.map((capture) => capture.fileName)),
      );
      expect(new Set(await readdir(outputDir))).toEqual(new Set(written));
      expect(await readGuardedFiles()).toEqual(guardedFilesBefore);

      for (const capture of CAPTURE_MATRIX) {
        const buffer = await readFile(path.join(outputDir, capture.fileName));
        expect(
          decodePng(buffer).width,
          `${capture.fileName} debería medir ${capture.viewport.width}px de ancho`,
        ).toBe(capture.viewport.width);
      }

      expect(await respondsAt(APP_URL)).toBe(false);
    },
    CAPTURE_TIMEOUT_MS,
  );

  it(
    "produce capturas distintas para el tema claro y el oscuro",
    async () => {
      outputDir = await mkdtemp(path.join(tmpdir(), "seadragons-ui-"));

      await captureUi({ outputDir });

      for (const viewportName of ["mobile", "tablet", "desktop"]) {
        const light = await readFile(
          path.join(outputDir, `ui-${viewportName}-light.png`),
        );
        const dark = await readFile(
          path.join(outputDir, `ui-${viewportName}-dark.png`),
        );

        expect(
          light.equals(dark),
          `ui-${viewportName}-light.png y ui-${viewportName}-dark.png son idénticos: el tema no se aplicó`,
        ).toBe(false);
      }
    },
    CAPTURE_TIMEOUT_MS,
  );

  it(
    "se niega a capturar cuando otro servidor ya responde en el puerto",
    async () => {
      outputDir = await mkdtemp(path.join(tmpdir(), "seadragons-ui-"));
      // En otro proceso a propósito: el arranque del servidor es síncrono y
      // bloquea el bucle de eventos, así que un intruso dentro de este mismo
      // proceso no podría contestar y ui-preflight lo daría por puerto libre.
      intruder = spawn(
        process.execPath,
        [
          "-e",
          `require("http").createServer((_, r) => r.end("no soy esta app")).listen(${APP_PORT})`,
        ],
        { stdio: "ignore" },
      );
      await waitUntilResponds(APP_URL);

      await expect(captureUi({ outputDir })).rejects.toThrow(/already answers/);
      expect(await readdir(outputDir)).toEqual([]);
      expect(await respondsAt(APP_URL)).toBe(true);
    },
    CAPTURE_TIMEOUT_MS,
  );
});

describe("limpieza ante fallo", () => {
  it(
    "apaga el dev server aunque el trabajo reviente después de arrancarlo",
    async () => {
      // Un archivo donde se espera un directorio: el fallo ocurre ya con el
      // servidor en pie, que es el escenario que importa.
      const notADirectory = path.join(
        await mkdtemp(path.join(tmpdir(), "seadragons-ui-")),
        "archivo",
      );
      await writeFile(notADirectory, "no soy un directorio");

      await expect(captureUi({ outputDir: notADirectory })).rejects.toThrow();

      expect(await respondsAt(APP_URL)).toBe(false);
    },
    CAPTURE_TIMEOUT_MS,
  );

  it(
    "sale con código distinto de cero cuando los argumentos no valen",
    async () => {
      const exitCode = await runCommand(["--pat", "/x"]);

      expect(exitCode).toBe(1);
    },
    CAPTURE_TIMEOUT_MS,
  );
});

function runCommand(args: readonly string[]): Promise<number | null> {
  const child = spawn(
    process.execPath,
    ["--experimental-strip-types", "scripts/capture-ui.ts", ...args],
    { stdio: "ignore" },
  );
  return new Promise((resolve) => child.on("close", resolve));
}
