import { execFileSync } from "node:child_process";
import { FILES_NEXT_DEV_REWRITES, withRestoredFiles } from "./tree-guard.ts";

const PREFLIGHT_SCRIPT = "scripts/ui-preflight.sh";

export interface DevServerControls {
  /** Arranca el servidor y devuelve su URL. Lanza si el puerto no es utilizable. */
  readonly start: () => string;
  readonly stop: () => void;
}

/** Lo que execFileSync cuelga del Error cuando el proceso termina mal. */
interface ExecFailure {
  readonly status?: number | null;
  readonly signal?: NodeJS.Signals | null;
  readonly stdout?: Buffer | string;
  readonly stderr?: Buffer | string;
}

function isExecFailure(error: unknown): error is Error & ExecFailure {
  return error instanceof Error && ("status" in error || "stderr" in error);
}

function describeExit(failure: ExecFailure): string {
  if (failure.signal) {
    return `bash murió por la señal ${failure.signal}`;
  }
  if (typeof failure.status === "number") {
    return `bash salió con código ${failure.status}`;
  }
  return "bash no llegó a ejecutarse";
}

function describeStream(
  label: string,
  content: Buffer | string | undefined,
): string | undefined {
  const text = content?.toString().trim();
  return text ? `${label}:\n${text}` : undefined;
}

/**
 * El código de salida va SIEMPRE, y stdout acompaña a stderr.
 *
 * Quedarse con el stderr a secas deja mensajes que engañan: cuando 'up' se
 * muere después de comprobar el puerto, lo último que escribió es
 * "http://localhost:3417 is free", así que el error acaba encabezado por una
 * línea de éxito y no dice nada de la causa (visto en CI, issue #102). El
 * código distingue un die() del script (1) de una muerte por set -e o por
 * SIGPIPE en una tubería (141), que es justo lo que allí había que
 * averiguar y no se podía.
 */
export function describeFailure(error: unknown): string {
  if (!isExecFailure(error)) {
    return error instanceof Error ? error.message : String(error);
  }
  return [
    describeExit(error),
    describeStream("stderr", error.stderr),
    describeStream("stdout", error.stdout),
  ]
    .filter((part): part is string => part !== undefined)
    .join("\n");
}

export const preflightControls: DevServerControls = {
  start: () => {
    try {
      return execFileSync("bash", [PREFLIGHT_SCRIPT, "up"], {
        encoding: "utf8",
      }).trim();
    } catch (error) {
      throw new Error(
        `ui-preflight no pudo arrancar el servidor:\n${describeFailure(error)}`,
      );
    }
  },
  stop: () => {
    // Sin stdio:"ignore": si down() no logra apagar el servidor de verdad,
    // captura su stderr (el "WARNING, something still answers..." que
    // imprime) para que describeFailure pueda incluirlo en el error, en vez
    // de perderlo en silencio y dejar solo el mensaje genérico de Node.
    try {
      execFileSync("bash", [PREFLIGHT_SCRIPT, "down"], { encoding: "utf8" });
    } catch (error) {
      throw new Error(
        `ui-preflight no pudo apagar el servidor:\n${describeFailure(error)}`,
      );
    }
  },
};

/**
 * Arranca el dev server, ejecuta el trabajo y lo apaga SIEMPRE, dentro del
 * mismo proceso. Ese es el punto: un servidor lanzado en una llamada del
 * agente y usado en la siguiente no sobrevive al viaje.
 */
export async function withDevServer<T>(
  run: (appUrl: string) => Promise<T>,
  controls: DevServerControls = preflightControls,
): Promise<T> {
  return withRestoredFiles(FILES_NEXT_DEV_REWRITES, async () => {
    const appUrl = controls.start();

    let result: T;
    try {
      result = await run(appUrl);
    } catch (error) {
      stopAfterFailure(controls, error);
      throw error;
    }

    controls.stop();
    return result;
  });
}

/**
 * Apaga tras un error del trabajo. El error original manda, porque dice qué se
 * rompió de verdad, pero un apagado fallido deja el puerto ocupado para la
 * siguiente corrida y no puede quedarse solo en la consola: viaja en el propio
 * error, donde lo ve quien lo capture sin mirar stdout.
 */
function stopAfterFailure(controls: DevServerControls, failure: unknown): void {
  try {
    controls.stop();
  } catch (stopError) {
    const note = `Además, no se pudo apagar el dev server: ${describeFailure(stopError)}`;
    if (failure instanceof Error) {
      failure.message = `${failure.message}
${note}`;
      failure.cause ??= stopError;
      return;
    }
    console.error(note);
  }
}
