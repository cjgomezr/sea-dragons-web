import { execFileSync } from "node:child_process";

const PREFLIGHT_SCRIPT = "scripts/ui-preflight.sh";

export interface DevServerControls {
  /** Arranca el servidor y devuelve su URL. Lanza si el puerto no es utilizable. */
  readonly start: () => string;
  readonly stop: () => void;
}

function describeFailure(error: unknown): string {
  if (error !== null && typeof error === "object" && "stderr" in error) {
    const stderr = (error as { stderr?: Buffer | string }).stderr;
    if (stderr) {
      return stderr.toString().trim();
    }
  }
  return error instanceof Error ? error.message : String(error);
}

export const preflightControls: DevServerControls = {
  start: () => {
    try {
      return execFileSync("bash", [PREFLIGHT_SCRIPT, "up"], { encoding: "utf8" }).trim();
    } catch (error) {
      throw new Error(`ui-preflight no pudo arrancar el servidor:\n${describeFailure(error)}`);
    }
  },
  stop: () => {
    execFileSync("bash", [PREFLIGHT_SCRIPT, "down"], { stdio: "ignore" });
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
