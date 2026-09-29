/**
 * Cuántos workers abre `npm test`.
 *
 * Por defecto Vitest abre uno menos que los núcleos de la máquina, sin mirar
 * la memoria. Cada worker de esta suite monta su propio jsdom, así que en un
 * portátil de 8 núcleos y 8 GB los siete workers se quedaban sin memoria: la
 * suite tardaba más de 12 minutos y los tests que lanzan scripts de shell o
 * esperan a la pantalla agotaban su plazo sin estar rotos. Con cuatro workers
 * la misma máquina la pasa entera, y más rápido.
 *
 * Por eso manda el menor de los dos límites: los núcleos, como hasta ahora,
 * y la memoria. En el runner de CI (4 núcleos, 16 GB) sigue saliendo 3, lo
 * mismo que antes.
 */

/** La memoria que se reserva por worker. Sale de una sola medición, la del
 * portátil de 8 GB: con cuatro workers pasó y con siete no. Si alguien la
 * cambia, que mida de nuevo. */
export const MEMORY_PER_WORKER_BYTES = 2 * 1024 ** 3;

const MINIMUM_WORKERS = 1;

export type MachineResources = {
  readonly cpuCount: number;
  readonly totalMemoryBytes: number;
};

export function selectMaxWorkers({
  cpuCount,
  totalMemoryBytes,
}: MachineResources): number {
  const workersByCpu = cpuCount - 1;
  const workersByMemory = Math.floor(
    totalMemoryBytes / MEMORY_PER_WORKER_BYTES,
  );
  return Math.max(MINIMUM_WORKERS, Math.min(workersByCpu, workersByMemory));
}
