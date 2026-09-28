import type { IsoWeekday } from "./event-occurrences";
import {
  type EventFields,
  EventValidationError,
  findEventOrganizer,
} from "./event-creation";
import {
  type EventManagementGateways,
  normalizeChanges,
} from "./event-management";

/**
 * Editar y cancelar una serie entera de hoy en adelante (#315, RF-12 del PRD
 * de E7), contado sin Supabase delante.
 *
 * Sólo cambian las ocurrencias futuras no canceladas, incluidas las que se
 * habían editado solas; lo que ya ocurrió no se toca nunca. "Futura" es la
 * que todavía no empezó según la hora de la base, la misma regla que el RSVP
 * (#308), y por eso la decide el adaptador al escribir y no el dominio al
 * leer. Los días y las fechas de la serie no se editan: para eso se cancela
 * el resto y se crea otra.
 *
 * El club sale de la fila de quien llama (NFR-009): una serie de otro club
 * no se encuentra, igual que una que no existe.
 */

/** Una serie como la ve quien la organiza. */
export type ManagedSeries = EventFields & {
  readonly id: string;
  readonly weekdays: readonly IsoWeekday[];
  readonly startsOn: string;
  readonly endsOn: string;
};

/** Lo que se puede cambiar de una serie; lo que no viene se queda igual. */
export type SeriesEdit = Partial<EventFields>;

export type ManagedSeriesGateway = {
  /** La serie, si es de ese club. */
  findSeries(query: {
    readonly clubId: string;
    readonly seriesId: string;
  }): Promise<ManagedSeries | null>;
  /** Escribe los cambios en la serie y en sus ocurrencias futuras no
   * canceladas, todo o nada, y dice cuántas ocurrencias cambió. Con cero no
   * escribe nada, ni siquiera la serie. */
  updateSeries(update: {
    readonly clubId: string;
    readonly seriesId: string;
    readonly changes: SeriesEdit;
  }): Promise<number>;
  /** Cancela las ocurrencias que no empezaron antes de `cancelledAt` y dice
   * cuántas. */
  cancelSeries(cancellation: {
    readonly clubId: string;
    readonly seriesId: string;
    readonly cancelledAt: Date;
  }): Promise<number>;
};

export type SeriesManagementGateways = Pick<
  EventManagementGateways,
  "members" | "events"
> & {
  readonly managedSeries: ManagedSeriesGateway;
};

/** La serie como quedó y cuántas ocurrencias recibieron los cambios. */
export type EditedSeries = {
  readonly series: ManagedSeries;
  readonly updatedOccurrences: number;
};

export type CancelledSeries = {
  readonly seriesId: string;
  readonly cancelledAt: string;
  readonly cancelledOccurrences: number;
};

export class SeriesNotFoundError extends Error {
  constructor() {
    super("La serie no existe.");
    this.name = "SeriesNotFoundError";
  }
}

type SeriesTarget = {
  readonly clubId: string;
  readonly seriesId: string;
};

async function findExistingSeries(
  gateways: Pick<SeriesManagementGateways, "managedSeries">,
  target: SeriesTarget,
): Promise<ManagedSeries> {
  const series = await gateways.managedSeries.findSeries(target);
  if (series === null) {
    throw new SeriesNotFoundError();
  }
  return series;
}

function assertSomethingChanged(changedOccurrences: number): void {
  if (changedOccurrences === 0) {
    throw new EventValidationError("series_without_upcoming");
  }
}

/** Cambia la serie y sus ocurrencias futuras no canceladas, o dice por qué
 * no. Si dos organizadores guardan a la vez, queda lo del último. */
export async function editSeries(
  gateways: SeriesManagementGateways,
  request: {
    readonly callerId: string;
    readonly seriesId: string;
    readonly changes: SeriesEdit;
  },
): Promise<EditedSeries> {
  const caller = await findEventOrganizer(gateways, request.callerId);
  const target = { clubId: caller.clubId, seriesId: request.seriesId };
  await findExistingSeries(gateways, target);
  const changes = await normalizeChanges(
    gateways,
    caller.clubId,
    request.changes,
  );
  const updatedOccurrences = await gateways.managedSeries.updateSeries({
    ...target,
    changes,
  });
  assertSomethingChanged(updatedOccurrences);
  return {
    series: await findExistingSeries(gateways, target),
    updatedOccurrences,
  };
}

/** Cancela las ocurrencias futuras de una serie, con la hora, sin borrar sus
 * respuestas. Las pasadas se quedan como estaban. */
export async function cancelSeries(
  gateways: SeriesManagementGateways,
  request: {
    readonly callerId: string;
    readonly seriesId: string;
    readonly now: Date;
  },
): Promise<CancelledSeries> {
  const caller = await findEventOrganizer(gateways, request.callerId);
  const target = { clubId: caller.clubId, seriesId: request.seriesId };
  await findExistingSeries(gateways, target);
  const cancelledOccurrences = await gateways.managedSeries.cancelSeries({
    ...target,
    cancelledAt: request.now,
  });
  assertSomethingChanged(cancelledOccurrences);
  return {
    seriesId: request.seriesId,
    cancelledAt: request.now.toISOString(),
    cancelledOccurrences,
  };
}
