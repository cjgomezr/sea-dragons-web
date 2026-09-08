import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { SIGINT_EXIT_CODE } from "../../../scripts/ui-review/tree-guard.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = path.join(HERE, "fixtures", "sigint-fixture.ts");
const ORIGINAL_CONTENT = '{\n  "compilerOptions": {}\n}\n';
const FIXTURE_TIMEOUT_MS = 20_000;

// El runner de CI (ubuntu-latest en checks.yml) fija Node 20, que no tiene
// --experimental-strip-types (llegó en Node 22.6): un spawn con esa flag
// muere ahí con "bad option" antes de imprimir nada, y este test agota su
// timeout esperando una señal de arranque que nunca llega. tsx transpila el
// entrypoint sin depender de esa flag ni de la versión de Node que lo corre.
const TSX_CLI = require.resolve("tsx/cli");

// Node no entrega señales POSIX reales a los hijos en Windows: child.kill("SIGINT")
// ahí solo termina el proceso a la fuerza, sin darle nunca la oportunidad de
// correr su propio listener (comprobado a mano: un hijo con
// process.on("SIGINT", ...) muere con signal=SIGINT pero jamás llega a
// imprimir lo que ese listener imprime). En Linux, donde corre este proyecto
// en CI, la señal sí se entrega de verdad, así que esta prueba solo tiene
// sentido ahí: en Windows solo demostraría que Windows mata procesos, no que
// el guard funciona.
describe.skipIf(process.platform === "win32")("suite de integración", () => {
  let workDir = "";
  let child: ChildProcess | undefined;

  afterEach(async () => {
    workDir = "";
    // El fixture nunca resuelve por su cuenta: si la aserción de arriba
    // revienta antes del child.kill("SIGINT") de la prueba, el proceso
    // se queda colgado esperando una señal que nunca llega.
    if (child && child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
    }
    child = undefined;
  });

  it(
    "restaura el archivo vigilado cuando el proceso recibe un SIGINT real del sistema operativo",
    async () => {
      workDir = await mkdtemp(path.join(tmpdir(), "tree-guard-sigint-"));
      const guardedFilePath = path.join(workDir, "tsconfig.json");
      await writeFile(guardedFilePath, ORIGINAL_CONTENT, "utf8");

      child = spawn(
        process.execPath,
        [TSX_CLI, FIXTURE_PATH, guardedFilePath],
        { stdio: ["ignore", "pipe", "inherit"] },
      );

      const ready = new Promise<void>((resolve, reject) => {
        child?.stdout?.on("data", (chunk: Buffer) => {
          if (chunk.toString("utf8").includes("listo-para-sigint")) {
            resolve();
          }
        });
        child?.on("error", reject);
      });
      const exited = new Promise<{
        code: number | null;
        signal: NodeJS.Signals | null;
      }>((resolve) => {
        child?.on("exit", (code, signal) => resolve({ code, signal }));
      });

      await ready;
      child.kill("SIGINT");
      const { code } = await exited;

      expect(code).toBe(SIGINT_EXIT_CODE);
      expect(await readFile(guardedFilePath, "utf8")).toBe(ORIGINAL_CONTENT);
    },
    FIXTURE_TIMEOUT_MS,
  );
});
