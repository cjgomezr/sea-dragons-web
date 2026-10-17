import { z } from "zod";
import {
  type ApiRequestFailure,
  JSON_REQUEST_HEADERS,
  readApiPayload,
  requestApi,
} from "@/lib/api/request-api";
import {
  EVENT_CANCELLATION_API_PATH,
  EVENT_MANAGE_API_PATH,
  EVENT_SERIES_CANCELLATION_API_PATH,
  EVENT_SERIES_MANAGE_API_PATH,
} from "@/lib/auth/routes";
import type { EventEdit } from "@/lib/events/event-management";
import type {
  SeriesEdit,
  SeriesScheduleEdit,
} from "@/lib/events/series-management";
import type { Translator } from "@/lib/i18n/translator";

/**
 * Lo que las acciones de quien organiza (#316) le piden a la API v1 para
 * editar y cancelar (#314, #315), y cómo reducen la respuesta a un aviso de
 * la agenda. Nada habla con la base: la aplicación nativa de Release 2 va a
 * usar estos mismos caminos (CON-002).
 *
 * Un evento que empezó, que otro canceló o que ya no existe no se arregla
 * reintentando: es un fallo "cerrado", que la agenda anuncia y resuelve
 * volviendo a pedir los eventos.
 */

/** A qué apunta una acción: al evento (o a una sola ocurrencia) o a toda la
 * serie de hoy en adelante. */
export type ManageTarget =
  | { readonly scope: "event"; readonly eventId: string }
  | { readonly scope: "series"; readonly seriesId: string };

export type ManageScope = ManageTarget["scope"];

/** Lo que se manda al editar una serie desde una sesión (#653, #654): los
 * cambios, y los días y la fecha final sólo si cambiaron. */
export type SeriesSplitEdit = SeriesEdit &
  SeriesScheduleEdit & { readonly fromOccurrenceId: string };

/** Por qué una acción ya no se puede hacer sobre lo que enseña la agenda. */
export type ClosedReason =
  | "event_started"
  | "event_cancelled"
  | "series_without_upcoming"
  | "occurrence_started"
  | "session_not_in_series"
  | "not_found";

/** Lo que la agenda anuncia cuando una acción termina. */
export type ManageNotice =
  | { readonly kind: "edited" }
  | { readonly kind: "editedSeries"; readonly sessionCount: number }
  | { readonly kind: "cancelled" }
  | { readonly kind: "cancelledSeries"; readonly sessionCount: number }
  | { readonly kind: "closed"; readonly reason: ClosedReason };

export type ManageSave =
  { readonly kind: "saved"; readonly notice: ManageNotice } | ApiRequestFailure;

// Del evento editado o cancelado no hace falta nada: la agenda se vuelve a
// pedir para pintarlo. De una serie, cuántas sesiones cambiaron.
const managedEventSchema = z.object({ data: z.object({ id: z.uuid() }) });

const editedSeriesSchema = z.object({
  data: z.object({ updatedOccurrences: z.number().int().nonnegative() }),
});

const cancelledSeriesSchema = z.object({
  data: z.object({ cancelledOccurrences: z.number().int().nonnegative() }),
});

function managePath(template: string, id: string): string {
  return template.replace("[id]", encodeURIComponent(id));
}

function patchJson(body: EventEdit | SeriesSplitEdit): RequestInit {
  return {
    method: "PATCH",
    headers: JSON_REQUEST_HEADERS,
    body: JSON.stringify(body),
  };
}

/** Guarda lo que cambió del evento o de la serie. */
export async function saveChanges(
  target: ManageTarget,
  changes: EventEdit | SeriesSplitEdit,
): Promise<ManageSave> {
  if (target.scope === "event") {
    const read = readApiPayload(
      await requestApi(
        managePath(EVENT_MANAGE_API_PATH, target.eventId),
        patchJson(changes),
      ),
      managedEventSchema,
    );
    return read.kind === "failed"
      ? read
      : { kind: "saved", notice: { kind: "edited" } };
  }
  const read = readApiPayload(
    await requestApi(
      managePath(EVENT_SERIES_MANAGE_API_PATH, target.seriesId),
      patchJson(changes),
    ),
    editedSeriesSchema,
  );
  return read.kind === "failed"
    ? read
    : {
        kind: "saved",
        notice: {
          kind: "editedSeries",
          sessionCount: read.value.data.updatedOccurrences,
        },
      };
}

/** Cancela el evento o lo que queda de la serie. */
export async function cancelTarget(target: ManageTarget): Promise<ManageSave> {
  if (target.scope === "event") {
    const read = readApiPayload(
      await requestApi(
        managePath(EVENT_CANCELLATION_API_PATH, target.eventId),
        { method: "POST" },
      ),
      managedEventSchema,
    );
    return read.kind === "failed"
      ? read
      : { kind: "saved", notice: { kind: "cancelled" } };
  }
  const read = readApiPayload(
    await requestApi(
      managePath(EVENT_SERIES_CANCELLATION_API_PATH, target.seriesId),
      { method: "POST" },
    ),
    cancelledSeriesSchema,
  );
  return read.kind === "failed"
    ? read
    : {
        kind: "saved",
        notice: {
          kind: "cancelledSeries",
          sessionCount: read.value.data.cancelledOccurrences,
        },
      };
}

const CLOSED_BUSINESS_REASONS: readonly string[] = [
  "event_started",
  "event_cancelled",
  "series_without_upcoming",
  "occurrence_started",
] satisfies readonly ClosedReason[];

function isClosedBusinessReason(reason: string): reason is ClosedReason {
  return CLOSED_BUSINESS_REASONS.includes(reason);
}

/** El aviso de un fallo que reintentar no arregla, o null si reintentar sí
 * puede servir (la red, la sesión) o el fallo va junto a un campo. */
export function readClosedNotice({
  failure,
  reason,
}: ApiRequestFailure): ManageNotice | null {
  if (failure === "not_found") {
    return { kind: "closed", reason: "not_found" };
  }
  if (
    failure === "business_rule" &&
    reason !== null &&
    isClosedBusinessReason(reason)
  ) {
    return { kind: "closed", reason };
  }
  return null;
}

/** Otra edición partió la serie desde antes de esta sesión (#653):
 * reintentar no sirve, hay que ver la serie como quedó. */
export function isSeriesChangedFailure({
  failure,
  reason,
}: ApiRequestFailure): boolean {
  return failure === "conflict" && reason === "session_not_in_series";
}

/** Por qué no se guardó o no se canceló, cuando reintentar puede servir. */
export function describeManageFailure(
  translate: Translator,
  requestFailure: ApiRequestFailure,
): string {
  if (isSeriesChangedFailure(requestFailure)) {
    return translate("calendar.manage.error.seriesChanged");
  }
  switch (requestFailure.failure) {
    case "network":
      return translate("calendar.form.error.network");
    case "unauthenticated":
      return translate("calendar.form.error.signInRequired");
    case "forbidden":
      return translate("calendar.manage.error.forbidden");
    default:
      return translate("calendar.manage.error.unexpected");
  }
}

/** El aviso de la agenda cuando una acción terminó. */
export function describeManageNotice(
  translate: Translator,
  notice: ManageNotice,
): string {
  switch (notice.kind) {
    case "edited":
      return translate("calendar.manage.edited");
    case "editedSeries":
      return translate("calendar.manage.editedSeries", {
        count: notice.sessionCount,
      });
    case "cancelled":
      return translate("calendar.manage.cancelled");
    case "cancelledSeries":
      return translate("calendar.manage.cancelledSeries", {
        count: notice.sessionCount,
      });
    case "closed":
      return translate(`calendar.manage.closed.${notice.reason}`);
  }
}
