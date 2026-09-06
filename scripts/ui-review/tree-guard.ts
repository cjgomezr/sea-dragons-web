import { readFile, rm, writeFile } from "node:fs/promises";

// Un SIGINT en pleno arranque del dev server deja el proceso muerto antes de
// que su propio finally corra, así que esta señal necesita su propio camino
// de restauración: no puede depender del try/finally del trabajo interrumpido.
const SIGINT_EXIT_CODE = 130;

export interface TreeGuardProcess {
  readonly on: (event: "SIGINT", listener: () => void) => void;
  readonly off: (event: "SIGINT", listener: () => void) => void;
  readonly exit: (code?: number) => never;
}

interface FileSnapshot {
  readonly path: string;
  /** `null` significa que el archivo no existía antes de la corrida. */
  readonly content: string | null;
}

async function snapshotFiles(
  paths: readonly string[],
): Promise<FileSnapshot[]> {
  return Promise.all(
    paths.map(async (path): Promise<FileSnapshot> => {
      try {
        return { path, content: await readFile(path, "utf8") };
      } catch {
        return { path, content: null };
      }
    }),
  );
}

async function restoreFiles(snapshots: readonly FileSnapshot[]): Promise<void> {
  await Promise.all(
    snapshots.map(({ path, content }) =>
      content === null
        ? rm(path, { force: true })
        : writeFile(path, content, "utf8"),
    ),
  );
}

/**
 * Corre `run` garantizando que `paths` queden byte a byte como estaban antes,
 * sin importar si `run` termina bien, revienta, o el proceso recibe SIGINT
 * mientras tanto. Pensado para envolver herramientas (como `next dev`) que
 * reescriben archivos versionados como efecto secundario de arrancar.
 */
export async function withRestoredFiles<T>(
  paths: readonly string[],
  run: () => Promise<T>,
  processLike: TreeGuardProcess = process,
): Promise<T> {
  const snapshots = await snapshotFiles(paths);

  const onSigint = (): void => {
    restoreFiles(snapshots)
      .catch((restoreError: unknown) => {
        console.error(
          `tree-guard: no se pudieron restaurar los archivos tras SIGINT: ${String(restoreError)}`,
        );
      })
      .finally(() => processLike.exit(SIGINT_EXIT_CODE));
  };
  processLike.on("SIGINT", onSigint);

  try {
    return await run();
  } finally {
    processLike.off("SIGINT", onSigint);
    await restoreFiles(snapshots);
  }
}
