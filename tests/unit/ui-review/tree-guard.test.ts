import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  SIGINT_EXIT_CODE,
  withRestoredFiles,
  type TreeGuardProcess,
} from "../../../scripts/ui-review/tree-guard.ts";

const ORIGINAL_TSCONFIG = '{\n  "compilerOptions": {}\n}\n';
const ORIGINAL_CLAUDE_MD =
  "<!-- BEGIN:nextjs-agent-rules -->\noriginal\n<!-- END:nextjs-agent-rules -->\n";
const REWRITTEN_BY_NEXT = "reescrito por next dev en pleno arranque";

function createFakeProcess(
  onExit: (code?: number) => void,
): TreeGuardProcess & { triggerSigint: () => void } {
  let handler: (() => void) | undefined;
  return {
    on: (_event, listener) => {
      handler = listener;
    },
    off: () => {
      handler = undefined;
    },
    exit: ((code?: number) => {
      onExit(code);
    }) as unknown as (code?: number) => never,
    triggerSigint: () => handler?.(),
  };
}

describe("suite de integración", () => {
  let workDir = "";

  afterEach(async () => {
    workDir = "";
  });

  async function setUpTsconfig(): Promise<string> {
    workDir = await mkdtemp(path.join(tmpdir(), "tree-guard-"));
    const filePath = path.join(workDir, "tsconfig.json");
    await writeFile(filePath, ORIGINAL_TSCONFIG, "utf8");
    return filePath;
  }

  async function setUpClaudeMd(): Promise<string> {
    workDir = await mkdtemp(path.join(tmpdir(), "tree-guard-"));
    const filePath = path.join(workDir, "CLAUDE.md");
    await writeFile(filePath, ORIGINAL_CLAUDE_MD, "utf8");
    return filePath;
  }

  it("deja tsconfig.json sin cambios tras una corrida exitosa", async () => {
    const tsconfigPath = await setUpTsconfig();

    const result = await withRestoredFiles([tsconfigPath], async () => {
      await writeFile(tsconfigPath, REWRITTEN_BY_NEXT, "utf8");
      return "ok";
    });

    expect(result).toBe("ok");
    expect(await readFile(tsconfigPath, "utf8")).toBe(ORIGINAL_TSCONFIG);
  });

  it("restaura tsconfig.json cuando el test falla", async () => {
    const tsconfigPath = await setUpTsconfig();

    await expect(
      withRestoredFiles([tsconfigPath], async () => {
        await writeFile(tsconfigPath, REWRITTEN_BY_NEXT, "utf8");
        throw new Error("la corrida reventó");
      }),
    ).rejects.toThrow("la corrida reventó");

    expect(await readFile(tsconfigPath, "utf8")).toBe(ORIGINAL_TSCONFIG);
  });

  it("restaura tsconfig.json cuando el proceso recibe SIGINT", async () => {
    const tsconfigPath = await setUpTsconfig();
    let resolveExited: (() => void) | undefined;
    const exited = new Promise<void>((resolve) => {
      resolveExited = resolve;
    });
    const fakeProcess = createFakeProcess((code) => {
      expect(code).toBe(SIGINT_EXIT_CODE);
      resolveExited?.();
    });

    const pending = withRestoredFiles(
      [tsconfigPath],
      async () => {
        await writeFile(tsconfigPath, REWRITTEN_BY_NEXT, "utf8");
        return new Promise(() => {
          // Nunca resuelve: simula el dev server siguiendo en pie cuando llega SIGINT.
        });
      },
      fakeProcess,
    );
    pending.catch(() => {
      // Nada que hacer: la promesa nunca se asienta porque el trabajo nunca resuelve.
    });

    await vi.waitFor(async () => {
      expect(await readFile(tsconfigPath, "utf8")).toBe(REWRITTEN_BY_NEXT);
    });

    fakeProcess.triggerSigint();
    await exited;

    expect(await readFile(tsconfigPath, "utf8")).toBe(ORIGINAL_TSCONFIG);
  });

  it("deja el bloque de agentes de CLAUDE.md sin cambios", async () => {
    const claudeMdPath = await setUpClaudeMd();

    await withRestoredFiles([claudeMdPath], async () => {
      await writeFile(
        claudeMdPath,
        "<!-- BEGIN:nextjs-agent-rules -->\nreescrito\n<!-- END:nextjs-agent-rules -->\n",
        "utf8",
      );
    });

    expect(await readFile(claudeMdPath, "utf8")).toBe(ORIGINAL_CLAUDE_MD);
  });
});
