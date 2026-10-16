import { z } from "zod";
import { ApiError } from "@/lib/api/response";
import { asAccountApiError } from "@/lib/auth/account-api";
import { describeMissingAuthKeys } from "@/lib/auth/supabase-auth-gateways";
import {
  EVENT_TYPES,
  type EventGateways,
  EventValidationError,
  EventsForbiddenError,
} from "./event-creation";
import { ISO_WEEKDAYS } from "./event-occurrences";
import {
  EventNotFoundError,
  type EventRsvpGateways,
  RSVP_RESPONSES,
  RsvpClosedError,
} from "./event-rsvp";
import {
  type EventAgendaGateways,
  InvalidAgendaCursorError,
} from "./event-agenda";
import { createSupabaseEventAgendaGateways } from "./supabase-event-agenda-gateways";
import type { EventManagementGateways } from "./event-management";
import {
  type SeriesManagementGateways,
  SeriesNotFoundError,
  SessionNotInSeriesError,
} from "./series-management";
import { createSupabaseEventGateways } from "./supabase-event-gateways";
import { createSupabaseEventManagementGateways } from "./supabase-event-management-gateways";
import { createSupabaseEventRsvpGateways } from "./supabase-event-rsvp-gateways";
import { createSupabaseSeriesManagementGateways } from "./supabase-series-management-gateways";

/**
 * Lo que comparten los endpoints de eventos (#307): cómo se cablean, la forma
 * de lo que llega y cómo responde cada error del dominio.
 *
 * Una petición sin la forma debida es un 400 (`validation_error`); una con la
 * forma pero que el calendario no admite, un 422 (`business_rule`) con el
 * motivo en `reason`, que la pantalla traduce.
 */

/** `HH:MM`, de 00:00 a 23:59, como la escribe un `<input type="time">`. */
const CLOCK_TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

const eventFieldsSchema = z.object({
  title: z.string(),
  eventType: z.enum(EVENT_TYPES),
  startTime: z.string().regex(CLOCK_TIME),
  // Que falte es un 422 (`end_time_required`) y no un 400: lo decide el
  // dominio, que también lo exige al editar algo anterior a E24 (D5).
  endTime: z.string().regex(CLOCK_TIME).nullable().optional(),
  location: z.string(),
  // Un lugar elegido (#645). Las coordenadas a medias o fuera de rango y los
  // textos demasiado largos son un 422 del dominio, no un 400.
  place: z
    .object({
      name: z.string(),
      address: z.string().nullable().optional(),
      lat: z.number().nullable().optional(),
      lng: z.number().nullable().optional(),
    })
    .nullable()
    .optional(),
  placeDetail: z.string().nullable().optional(),
  notes: z.string().nullable(),
  // Una subida de `POST /api/v1/events/manage/uploads` (#644). A `null`
  // quita la imagen; sin la clave, al editar no cambia. Que sea del club y
  // de quien organiza lo decide el dominio (422).
  coverUploadId: z.uuid().nullable().optional(),
  // Los ids de grupo tienen que ser uuid para no mandarle a Postgres un valor
  // que rechazaría. Que la lista no venga vacía lo decide el dominio (422).
  audience: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("club") }),
    z.object({ kind: z.literal("groups"), groupIds: z.array(z.uuid()) }),
  ]),
});

/** Un evento suelto o una serie semanal, según `repeat`. Una serie sin días
 * tiene la forma debida: se rechaza con 422, como pide el ticket. */
export const eventDraftSchema = z.discriminatedUnion("repeat", [
  eventFieldsSchema.extend({
    repeat: z.literal("none"),
    startsOn: z.iso.date(),
    // La de un evento de varios días. En una serie, `endsOn` es la de la
    // serie: sus sesiones son de un día (D6).
    endsOn: z.iso.date().nullable().optional(),
  }),
  eventFieldsSchema.extend({
    repeat: z.literal("weekly"),
    weekdays: z.array(z.union(ISO_WEEKDAYS.map((day) => z.literal(day)))),
    startsOn: z.iso.date(),
    endsOn: z.iso.date(),
  }),
]);

/** Lo que cambia de un evento suelto o una ocurrencia: los mismos campos que
 * al crear, todos opcionales, y al menos uno. `endsOn` a `null` lo vuelve de
 * un día. */
export const eventEditSchema = eventFieldsSchema
  .extend({ startsOn: z.iso.date(), endsOn: z.iso.date().nullable() })
  .partial()
  .refine((edit) => Object.values(edit).some((value) => value !== undefined), {
    message: "Envía al menos un campo que cambiar.",
  });

/** Lo que cambia de una serie: los mismos campos que al crear salvo la
 * fecha, todos opcionales, y al menos uno. Los días y las fechas de la serie
 * no se editan (#315), así que mandarlos es un 400 y no se ignoran en
 * silencio. `fromOccurrenceId` no es un cambio: dice desde qué sesión se
 * parte la serie (#653); sin él cambian todas las futuras desde hoy. */
export const seriesEditSchema = eventFieldsSchema
  .partial()
  .extend({ fromOccurrenceId: z.uuid().optional() })
  .strict()
  .refine(
    (edit) =>
      Object.entries(edit).some(
        ([field, value]) => field !== "fromOccurrenceId" && value !== undefined,
      ),
    { message: "Envía al menos un campo que cambiar." },
  );

export function requireSeriesManagementGateways(): SeriesManagementGateways {
  const wiring = createSupabaseSeriesManagementGateways(process.env);
  if (wiring.kind === "unconfigured") {
    throw new ApiError(
      "service_unavailable",
      describeMissingAuthKeys(wiring.missingKeys),
    );
  }
  return wiring.gateways;
}

export function requireEventManagementGateways(): EventManagementGateways {
  const wiring = createSupabaseEventManagementGateways(process.env);
  if (wiring.kind === "unconfigured") {
    throw new ApiError(
      "service_unavailable",
      describeMissingAuthKeys(wiring.missingKeys),
    );
  }
  return wiring.gateways;
}

export function requireEventGateways(): EventGateways {
  const wiring = createSupabaseEventGateways(process.env);
  if (wiring.kind === "unconfigured") {
    throw new ApiError(
      "service_unavailable",
      describeMissingAuthKeys(wiring.missingKeys),
    );
  }
  return wiring.gateways;
}

export const eventRsvpSchema = z.object({
  response: z.enum(RSVP_RESPONSES),
});

/** Un id que no es uuid no puede ser el de ningún evento: 404, sin preguntarle
 * a Postgres, que lo rechazaría con un error de tipo. */
export function readEventId(value: string): string {
  if (!z.uuid().safeParse(value).success) {
    throw new ApiError("not_found", new EventNotFoundError().message);
  }
  return value;
}

/** Lo mismo para una serie (#315). */
export function readSeriesId(value: string): string {
  if (!z.uuid().safeParse(value).success) {
    throw new ApiError("not_found", new SeriesNotFoundError().message);
  }
  return value;
}

export function requireEventRsvpGateways(): EventRsvpGateways {
  const wiring = createSupabaseEventRsvpGateways(process.env);
  if (wiring.kind === "unconfigured") {
    throw new ApiError(
      "service_unavailable",
      describeMissingAuthKeys(wiring.missingKeys),
    );
  }
  return wiring.gateways;
}

export function requireEventAgendaGateways(): EventAgendaGateways {
  const wiring = createSupabaseEventAgendaGateways(process.env);
  if (wiring.kind === "unconfigured") {
    throw new ApiError(
      "service_unavailable",
      describeMissingAuthKeys(wiring.missingKeys),
    );
  }
  return wiring.gateways;
}

export function asEventsApiError(error: unknown): never {
  if (error instanceof InvalidAgendaCursorError) {
    throw new ApiError("validation_error", error.message);
  }
  if (error instanceof EventValidationError) {
    throw new ApiError("business_rule", error.message, error.code);
  }
  if (error instanceof RsvpClosedError) {
    throw new ApiError("business_rule", error.message, error.code);
  }
  if (
    error instanceof EventNotFoundError ||
    error instanceof SeriesNotFoundError
  ) {
    throw new ApiError("not_found", error.message);
  }
  if (error instanceof EventsForbiddenError) {
    throw new ApiError("forbidden", error.message);
  }
  if (error instanceof SessionNotInSeriesError) {
    throw new ApiError("conflict", error.message, error.code);
  }
  return asAccountApiError(error);
}
