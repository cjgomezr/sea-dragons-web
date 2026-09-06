import { readFile, rm, writeFile } from "node:fs/promises";

// next dev reescribe estos dos archivos versionados al arrancar (tipos
// generados en tsconfig.json, el bloque de agentes en CLAUDE.md si no lo
// encuentra al día). Única fuente de verdad: quien arranca el dev server y
// quien verifica que no ensució el árbol comparten esta misma lista.
export const FILES_NEXT_DEV_REWRITES = ["tsconfig.json", "CLAUDE.md"] as const;

// Un SIGINT en pleno arranque del dev server deja el proceso muerto antes de
// que su propio finally corra, así que esta señal necesita su propio camino
// de restauración: no puede depender del try/finally del trabajo interrumpido.
export const SIGINT_EXIT_CODE = 130;

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
 *
 * Límite conocido: esto solo puede restaurar si el runtime llega a entregarle
 * la señal a este proceso. En Windows, `child_process`/Ctrl+C suele terminar
 * el proceso directamente en vez de invocar el listener de "SIGINT" (Node no
 * emula ahí una señal POSIX real); en Linux y macOS sí se entrega y este
 * mecanismo corre. Contra un SIGKILL, o cualquier terminación que no le dé
 * al runtime la oportunidad de correr JS, ninguna librería de espacio de
 * usuario puede garantizar una restauración: ni esta, ni un `finally` a secas.
 */
export async function withRestoredFiles<T>(
  paths: readonly string[],
  run: () => Promise<T>,
  processLike: TreeGuardProcess = process,
): Promise<T> {
  const snapshots = await snapshotFiles(paths);

  // El finally de abajo y el handler de SIGINT pueden dispararse casi al
  // mismo tiempo (la señal llega mientras `run` ya está resolviendo). Sin
  // memoizar, cada uno lanzaría su propia escritura de restauración: dos
  // escrituras concurrentes al mismo archivo, y si `exit()` corta el proceso
  // a mitad de la que pierde la carrera, el archivo queda truncado a medias.
  // Memoizar la promesa asegura una sola escritura real; quien llegue
  // segundo solo espera la que ya está en curso.
  let restorePromise: Promise<void> | undefined;
  const restoreOnce = (): Promise<void> => {
    restorePromise ??= restoreFiles(snapshots);
    return restorePromise;
  };

  const onSigint = (): void => {
    restoreOnce()
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
    await restoreOnce();
  }
}
