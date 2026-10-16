import {
  announceSeriesCancellation,
  announceSeriesChange,
} from "./event-change-notice";
import { clubMoment } from "@/lib/time/club-calendar";
import {
  type IsoWeekday,
  countRangeDays,
  generateWeeklyOccurrences,
} from "./event-occurrences";
import type { PlaceDraft } from "./event-place";
import {
  type EventFields,
  EventValidationError,
  SERIES_MAX_DAYS,
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
 * leer. Los días y las fechas de la serie sólo cambian al partirla.
 *
 * El club sale de la fila de quien llama (NFR-009): una serie de otro club
 * no se encuentra, igual que una que no existe.
 *
 * Desde una sesión ("esta y las siguientes", #653, D2 del PRD de E24) la
 * serie se parte en esa fecha: la original termina el día anterior y nace
 * otra con los cambios. Las sesiones anteriores no cambian, aunque sean
 * futuras. Al partir también se pueden cambiar los días y la fecha final
 * de la parte nueva (#654): lo que ya no encaja se cancela y lo que falta se
 * crea.
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

/** Los días y la fecha final nuevos de la parte nueva (#654); lo que no
 * viene se queda como en la serie. */
export type SeriesScheduleEdit = {
  readonly weekdays?: readonly IsoWeekday[];
  readonly endsOn?: string;
};

/** Lo que el adaptador escribe al cambiar los días o la fecha final:
 * `sessionDates` son las fechas futuras de la parte nueva desde la sesión
 * elegida, y `addedDates`, las que la serie no tenía. Lo que no cae en
 * `sessionDates` se cancela; en `addedDates` se reactiva la cancelada de esa
 * fecha o se crea una sesión nueva. Una sesión cancelada en una fecha que la
 * serie ya tenía sigue cancelada: alguien la canceló a propósito. */
export type SeriesReschedule = {
  readonly weekdays: readonly IsoWeekday[];
  readonly endsOn: string;
  readonly sessionDates: readonly string[];
  readonly addedDates: readonly string[];
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
  /** El día de una sesión, si es de esa serie y de ese club. */
  findSessionDay(query: {
    readonly clubId: string;
    readonly seriesId: string;
    readonly occurrenceId: string;
  }): Promise<string | null>;
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
   * escribe nada. Que la sesión ya empezó lo decide la hora de la base. Con
   * `schedule` también cambia los días y la fecha final de la parte nueva,
   * en la misma transacción, y cuenta las sesiones que cancela. */
  splitSeries(split: {
    readonly clubId: string;
    readonly seriesId: string;
    readonly fromOccurrenceId: string;
    readonly changes: SeriesEdit;
    readonly schedule: SeriesReschedule | null;
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

/** Una sola vez cada día, en orden. */
function normalizeWeekdays(
  weekdays: readonly IsoWeekday[],
): readonly IsoWeekday[] {
  const normalized = [...new Set(weekdays)].sort(
    (first, second) => first - second,
  );
  if (normalized.length === 0) {
    throw new EventValidationError("series_weekdays_empty");
  }
  return normalized;
}

/** Qué fechas tiene la parte nueva desde `fromDay` y cuáles no tenía, o por
 * qué no vale. Las dos cuentas usan la hora de inicio que va a quedar. */
function planReschedule(plan: {
  readonly before: ManagedSeries;
  readonly schedule: SeriesScheduleEdit;
  readonly fromDay: string;
  readonly startTime: string;
  readonly now: Date;
}): SeriesReschedule {
  const { before, schedule, fromDay, startTime } = plan;
  const weekdays = normalizeWeekdays(schedule.weekdays ?? before.weekdays);
  const endsOn = schedule.endsOn ?? before.endsOn;
  if (countRangeDays(fromDay, endsOn) > SERIES_MAX_DAYS) {
    throw new EventValidationError("series_range_too_long");
  }
  const moment = clubMoment(plan.now);
  const sessionDates = generateWeeklyOccurrences(
    { weekdays, startsOn: fromDay, endsOn, startTime },
    moment,
  );
  if (sessionDates.length === 0) {
    throw new EventValidationError("series_without_sessions");
  }
  const currentDates = new Set(
    generateWeeklyOccurrences(
      { ...before, startsOn: fromDay, startTime },
      moment,
    ),
  );
  return {
    weekdays,
    endsOn,
    sessionDates,
    addedDates: sessionDates.filter((date) => !currentDates.has(date)),
  };
}

type SplitRequest = SeriesTarget & {
  readonly fromOccurrenceId: string;
  readonly changes: SeriesEdit;
  readonly schedule: SeriesScheduleEdit | undefined;
  readonly before: ManagedSeries;
  readonly now: Date;
};

/** Lo que cambia de los días y la fecha final, con el día de la sesión
 * elegida; nada si no cambian. */
async function resolveReschedule(
  gateways: Pick<SeriesManagementGateways, "managedSeries">,
  request: SplitRequest,
): Promise<SeriesReschedule | null> {
  const { schedule, before, changes } = request;
  if (schedule === undefined) {
    return null;
  }
  const fromDay = await gateways.managedSeries.findSessionDay({
    clubId: request.clubId,
    seriesId: request.seriesId,
    occurrenceId: request.fromOccurrenceId,
  });
  if (fromDay === null) {
    throw new SessionNotInSeriesError();
  }
  return planReschedule({
    before,
    schedule,
    fromDay,
    startTime: changes.startTime ?? before.startTime,
    now: request.now,
  });
}

async function splitFromOccurrence(
  gateways: Pick<SeriesManagementGateways, "managedSeries">,
  request: SplitRequest,
): Promise<WrittenSeries> {
  const outcome = await gateways.managedSeries.splitSeries({
    clubId: request.clubId,
    seriesId: request.seriesId,
    fromOccurrenceId: request.fromOccurrenceId,
    changes: request.changes,
    schedule: await resolveReschedule(gateways, request),
  });
  switch (outcome.kind) {
    case "occurrence_started":
      throw new EventValidationError("occurrence_started");
    case "session_not_in_series":
      throw new SessionNotInSeriesError();
    default:
      return outcome;
  }
}

/** Desde dónde se edita: la serie entera de hoy en adelante, o desde una
 * sesión, con días o fecha final nuevos si vienen (#654). */
export type SeriesEditScope =
  | { readonly fromOccurrenceId?: undefined }
  | {
      readonly fromOccurrenceId: string;
      readonly schedule?: SeriesScheduleEdit;
    };

async function writeSeriesChanges(
  gateways: Pick<SeriesManagementGateways, "managedSeries">,
  write: SeriesTarget &
    SeriesEditScope & {
      readonly changes: SeriesEdit;
      readonly before: ManagedSeries;
      readonly now: Date;
    },
): Promise<WrittenSeries> {
  if (write.fromOccurrenceId !== undefined) {
    return splitFromOccurrence(gateways, {
      ...write,
      fromOccurrenceId: write.fromOccurrenceId,
      schedule: write.schedule,
    });
  }
  return {
    seriesId: write.seriesId,
    updatedOccurrences: await gateways.managedSeries.updateSeries({
      clubId: write.clubId,
      seriesId: write.seriesId,
      changes: write.changes,
    }),
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
 * empezó es un 422 y una que ya no es de la serie, un conflicto. Con
 * `schedule` cambian también los días o la fecha final desde esa sesión
 * (#654); `now` decide qué fechas quedan por delante.
 *
 * Si cambió la hora, el lugar, los días o la fecha final, la audiencia
 * recibe un solo aviso (#317): al partir, la de la serie nueva. */
export async function editSeries(
  gateways: SeriesManagementGateways,
  request: SeriesEditScope & {
    readonly callerId: string;
    readonly seriesId: string;
    readonly changes: SeriesEditDraft;
    readonly now: Date;
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
    ...request,
    ...target,
    changes,
    before,
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
