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
import { createSupabaseEventGateways } from "./supabase-event-gateways";
import { createSupabaseEventManagementGateways } from "./supabase-event-management-gateways";
import { createSupabaseEventRsvpGateways } from "./supabase-event-rsvp-gateways";

/**
 * Lo que comparten los endpoints de eventos (#307): cómo se cablean, la forma
 * de lo que llega y cómo responde cada error del dominio.
 *
 * Una petición sin la forma debida es un 400 (`validation_error`); una con la
 * forma pero que el calendario no admite, un 422 (`business_rule`) con el
 * motivo en `reason`, que la pantalla traduce.
 */

/** `HH:MM`, de 00:00 a 23:59, como la escribe un `<input type="time">`. */
const START_TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

const eventFieldsSchema = z.object({
  title: z.string(),
  eventType: z.enum(EVENT_TYPES),
  startTime: z.string().regex(START_TIME),
  location: z.string(),
  notes: z.string().nullable(),
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
  }),
  eventFieldsSchema.extend({
    repeat: z.literal("weekly"),
    weekdays: z.array(z.union(ISO_WEEKDAYS.map((day) => z.literal(day)))),
    startsOn: z.iso.date(),
    endsOn: z.iso.date(),
  }),
]);

/** Lo que cambia de un evento suelto o una ocurrencia: los mismos campos que
 * al crear, todos opcionales, y al menos uno. */
export const eventEditSchema = eventFieldsSchema
  .extend({ startsOn: z.iso.date() })
  .partial()
  .refine((edit) => Object.values(edit).some((value) => value !== undefined), {
    message: "Envía al menos un campo que cambiar.",
  });

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
  if (error instanceof EventNotFoundError) {
    throw new ApiError("not_found", error.message);
  }
  if (error instanceof EventsForbiddenError) {
    throw new ApiError("forbidden", error.message);
  }
  return asAccountApiError(error);
}
