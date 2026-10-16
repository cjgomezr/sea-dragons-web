import {
  announceSeriesCancellation,
  announceSeriesChange,
} from "./event-change-notice";
import type { IsoWeekday } from "./event-occurrences";
import type { PlaceDraft } from "./event-place";
import {
  type EventFields,
  EventValidationError,
  findEventOrganizer,
  resolveEventEnd,
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
 *
 * Desde una sesión ("esta y las siguientes", #653, D2 del PRD de E24) la
 * serie se parte en esa fecha: la original termina el día anterior y nace
 * otra con los cambios. Las sesiones anteriores no cambian, aunque sean
 * futuras.
 */

/** Una serie como la ve quien la organiza. */
export type ManagedSeries = EventFields & {
  readonly id: string;
  readonly weekdays: readonly IsoWeekday[];
  readonly startsOn: string;
  readonly endsOn: string;
};

/** Lo que se puede cambiar de una serie; lo que no viene se queda igual.
 * La imagen pasa a las sesiones futuras salvo a las que la cambiaron solas
 * (#644), y eso lo decide la base. */
export type SeriesEdit = Partial<
  EventFields & { readonly coverUploadId: string | null }
>;

/** Lo que cambia tal como llega, con el lugar todavía sin validar. */
export type SeriesEditDraft = Omit<SeriesEdit, "place"> & {
  readonly place?: PlaceDraft | null;
};

/** Cómo terminó partir una serie desde una sesión. `edited` es la serie
 * entera, cuando la elegida es su primera sesión; `split`, la serie nueva.
 * Con `updatedOccurrences` a 0 no se escribió nada: desde la elegida no
 * quedaba ninguna sesión futura sin cancelar. */
export type SeriesSplit =
  | {
      readonly kind: "edited" | "split";
      readonly seriesId: string;
      readonly updatedOccurrences: number;
    }
  | { readonly kind: "occurrence_started" }
  | { readonly kind: "session_not_in_series" };

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
  /** Parte la serie desde una sesión y aplica los cambios a la parte nueva,
   * todo o nada, con la serie bloqueada. Con cero ocurrencias por cambiar no
   * escribe nada. Que la sesión ya empezó lo decide la hora de la base. */
  splitSeries(split: {
    readonly clubId: string;
    readonly seriesId: string;
    readonly fromOccurrenceId: string;
    readonly changes: SeriesEdit;
  }): Promise<SeriesSplit>;
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
  "members" | "events" | "eventCovers" | "eventAudience" | "notifications"
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

/** La sesión ya no es de esa serie: no lo fue nunca, o otra partición se la
 * llevó antes. Quien edita tiene que recargar. */
export class SessionNotInSeriesError extends Error {
  readonly code = "session_not_in_series";

  constructor() {
    super("La sesión ya no es de esta serie: recarga y vuelve a intentarlo.");
    this.name = "SessionNotInSeriesError";
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

/** Las sesiones de una serie son de un día (D6), y una serie anterior a E24
 * no se guarda sin hora de fin aunque no se toque la hora (D5). La hora de
 * fin sólo se escribe si viene: así una sesión editada sola conserva la
 * suya. */
function assertValidEnd(series: ManagedSeries, changes: SeriesEdit): void {
  resolveEventEnd({
    startsOn: series.startsOn,
    startTime: changes.startTime ?? series.startTime,
    endTime: changes.endTime === undefined ? series.endTime : changes.endTime,
    endsOn: null,
    isSeriesSession: true,
  });
}

function assertSomethingChanged(changedOccurrences: number): void {
  if (changedOccurrences === 0) {
    throw new EventValidationError("series_without_upcoming");
  }
}

type WrittenSeries = {
  readonly seriesId: string;
  readonly updatedOccurrences: number;
};

async function splitFromOccurrence(
  gateways: Pick<SeriesManagementGateways, "managedSeries">,
  split: SeriesTarget & {
    readonly fromOccurrenceId: string;
    readonly changes: SeriesEdit;
  },
): Promise<WrittenSeries> {
  const outcome = await gateways.managedSeries.splitSeries(split);
  switch (outcome.kind) {
    case "occurrence_started":
      throw new EventValidationError("occurrence_started");
    case "session_not_in_series":
      throw new SessionNotInSeriesError();
    default:
      return outcome;
  }
}

async function writeSeriesChanges(
  gateways: Pick<SeriesManagementGateways, "managedSeries">,
  write: SeriesTarget & {
    readonly fromOccurrenceId: string | undefined;
    readonly changes: SeriesEdit;
  },
): Promise<WrittenSeries> {
  const { fromOccurrenceId, ...update } = write;
  if (fromOccurrenceId !== undefined) {
    return splitFromOccurrence(gateways, { ...update, fromOccurrenceId });
  }
  return {
    seriesId: update.seriesId,
    updatedOccurrences: await gateways.managedSeries.updateSeries(update),
  };
}

/** Cambia la serie y sus ocurrencias futuras no canceladas, o dice por qué
 * no. Si dos organizadores guardan a la vez, queda lo del último.
 *
 * Qué ocurrencia es futura se decide con su hora de antes del cambio: a las
 * 18:00, pasar la serie de las 19:00 a las 17:00 mueve también la de hoy, que
 * queda en una hora ya pasada. Editar una sola ocurrencia (#314) lo rechaza;
 * aquí no, porque la serie no tiene una fecha que validar.
 *
 * Con `fromOccurrenceId` parte la serie desde esa sesión (#653) y devuelve
 * la serie nueva; si es la primera, edita la entera. Una sesión que ya
 * empezó es un 422 y una que ya no es de la serie, un conflicto.
 *
 * Si cambió la hora o el lugar, la audiencia recibe un solo aviso (#317): al
 * partir, la de la serie nueva. */
export async function editSeries(
  gateways: SeriesManagementGateways,
  request: {
    readonly callerId: string;
    readonly seriesId: string;
    readonly fromOccurrenceId?: string;
    readonly changes: SeriesEditDraft;
  },
): Promise<EditedSeries> {
  const caller = await findEventOrganizer(gateways, request.callerId);
  const target = { clubId: caller.clubId, seriesId: request.seriesId };
  const before = await findExistingSeries(gateways, target);
  const changes = await normalizeChanges(
    gateways,
    { clubId: caller.clubId, userId: request.callerId },
    request.changes,
  );
  assertValidEnd(before, changes);
  const written = await writeSeriesChanges(gateways, {
    ...target,
    fromOccurrenceId: request.fromOccurrenceId,
    changes,
  });
  assertSomethingChanged(written.updatedOccurrences);
  const series = await findExistingSeries(gateways, {
    clubId: caller.clubId,
    seriesId: written.seriesId,
  });
  await announceSeriesChange(gateways, {
    clubId: caller.clubId,
    authorId: request.callerId,
    before,
    after: series,
  });
  return { series, updatedOccurrences: written.updatedOccurrences };
}

/** Cancela las ocurrencias futuras de una serie, con la hora, sin borrar sus
 * respuestas, y se lo avisa una vez a la audiencia (#317). Las pasadas se
 * quedan como estaban. */
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
  const series = await findExistingSeries(gateways, target);
  const cancelledOccurrences = await gateways.managedSeries.cancelSeries({
    ...target,
    cancelledAt: request.now,
  });
  assertSomethingChanged(cancelledOccurrences);
  await announceSeriesCancellation(gateways, {
    clubId: caller.clubId,
    authorId: request.callerId,
    cancelled: series,
  });
  return {
    seriesId: request.seriesId,
    cancelledAt: request.now.toISOString(),
    cancelledOccurrences,
  };
}
