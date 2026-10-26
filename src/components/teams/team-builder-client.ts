import { z } from "zod";
import {
  type ApiRequestFailure,
  JSON_REQUEST_HEADERS,
  readApiPayload,
  requestApi,
} from "@/lib/api/request-api";
import {
  CLUB_TEAM_LABELS_API_PATH,
  TEAMS_API_PATH,
  TEAM_AUTO_BALANCE_API_PATH,
  TEAM_BUILDER_API_PATH,
  TEAM_PUBLICATION_API_PATH,
} from "@/lib/auth/routes";
import { EVENT_TYPES } from "@/lib/events/event-creation";
import type { Translator } from "@/lib/i18n/translator";
import {
  EVENT_SPLIT_LABELS,
  type EventSplitChange,
  TEAM_IDS,
  TEAM_SPLIT_MODES,
  type TeamAssignment,
  type TeamLabels,
} from "@/lib/teams/team-ids";

/**
 * Lo que la pantalla de Equipos (#402) le pide a la API v1 (#401) y cómo
 * reduce cada respuesta a algo que pintar.
 *
 * Nada habla con la base: la aplicación nativa de Release 2 va a usar estos
 * mismos caminos (CON-002). De un error se guarda el código y no la frase,
 * para que el aviso cambie de idioma con el interruptor (E17).
 */

const eventSummarySchema = z.object({
  id: z.uuid(),
  title: z.string(),
  eventType: z.enum(EVENT_TYPES),
  startsOn: z.iso.date(),
  startTime: z.string(),
});

const eventsResponseSchema = z.object({
  data: z.object({ events: z.array(eventSummarySchema) }),
});

const teamLabelSchema = z.object({ name: z.string(), color: z.string() });

const teamLabelsSchema = z.object({ a: teamLabelSchema, b: teamLabelSchema });

const localizedNamesSchema = z.object({
  en: z.string().nullable(),
  es: z.string().nullable(),
});

const squadEntrySchema = z.object({
  userId: z.uuid(),
  fullName: z.string(),
  position: z
    .object({ id: z.string(), names: localizedNamesSchema })
    .nullable(),
  positionId: z.string().nullable(),
  rating: z.number(),
  isUnrated: z.boolean(),
  photoUrl: z.string().nullable(),
});

/** Una posición activa con mínimo (E34): lo que exige el reparto. */
const positionRequirementSchema = z.object({
  id: z.string(),
  names: localizedNamesSchema,
  shortNames: localizedNamesSchema,
  minPerTeam: z.number().int().positive(),
});

const builderResponseSchema = z.object({
  data: z.object({
    event: eventSummarySchema,
    teams: teamLabelsSchema,
    available: z.array(squadEntrySchema),
    maybe: z.array(squadEntrySchema),
    split: z
      .object({
        mode: z.enum(TEAM_SPLIT_MODES),
        publishedAt: z.string().nullable(),
        assignments: z.array(
          squadEntrySchema.extend({
            team: z.enum(TEAM_IDS),
            isOutsideSquad: z.boolean(),
          }),
        ),
      })
      .nullable(),
    requirements: z.array(positionRequirementSchema),
  }),
});

const balancedResponseSchema = z.object({
  data: z.object({
    teams: teamLabelsSchema,
    a: z.array(squadEntrySchema),
    b: z.array(squadEntrySchema),
  }),
});

const clubTeamsResponseSchema = z.object({ data: teamLabelsSchema });

const clubTeamsChangeResponseSchema = z.object({
  data: z.union([
    teamLabelsSchema.extend({ eventSplit: z.enum(EVENT_SPLIT_LABELS) }),
    teamLabelsSchema.extend({
      eventSplit: z.literal("relabelledPublished"),
      notifiedCount: z.number().int().nonnegative(),
    }),
  ]),
});

const savedResponseSchema = z.object({
  data: z.object({ assignedCount: z.number().int().nonnegative() }),
});

const publishedResponseSchema = z.object({
  data: z.object({
    publishedAt: z.string(),
    notifiedCount: z.number().int().nonnegative(),
  }),
});

export type BuildableEvent = z.infer<typeof eventSummarySchema>;

export type RosterEntry = z.infer<typeof squadEntrySchema>;

export type OpenedBuilder = z.infer<typeof builderResponseSchema>["data"];

export type TeamsFailure = ApiRequestFailure;

export type EventsLoad =
  | { readonly kind: "loaded"; readonly events: readonly BuildableEvent[] }
  | TeamsFailure;

export type BuilderLoad =
  { readonly kind: "loaded"; readonly builder: OpenedBuilder } | TeamsFailure;

/** Los dos equipos que repartió el servidor, con cada jugador entero: puede
 * traer a alguien que dijo Sí después de abrir la pantalla. */
export type BalancedSplit = {
  readonly teams: TeamLabels;
  readonly a: readonly RosterEntry[];
  readonly b: readonly RosterEntry[];
};

export type BalanceOutcome =
  { readonly kind: "balanced"; readonly split: BalancedSplit } | TeamsFailure;

export type SaveOutcome = { readonly kind: "saved" } | TeamsFailure;

export type PublishOutcome =
  | {
      readonly kind: "published";
      readonly publishedAt: string;
      readonly notifiedCount: number;
    }
  | TeamsFailure;

export type ClubTeamsLoad =
  { readonly kind: "loaded"; readonly teams: TeamLabels } | TeamsFailure;

export type TeamsChangeOutcome =
  | ({
      readonly kind: "changed";
      readonly teams: TeamLabels;
    } & EventSplitChange)
  | TeamsFailure;

/** Lo que ve la ventana de editar: `busy` si guardar, publicar o balancear
 * siguen en vuelo y el cambio no se mandó. */
export type TeamsEditOutcome = TeamsChangeOutcome | { readonly kind: "busy" };

function eventPath(template: string, eventId: string): string {
  return template.replace("[eventId]", encodeURIComponent(eventId));
}

/** Los armables de hoy en adelante, del más cercano al más lejano. Nunca
 * rechaza: un fallo de red sale como fallo. */
export async function loadBuildableEvents(): Promise<EventsLoad> {
  const read = readApiPayload(
    await requestApi(TEAMS_API_PATH),
    eventsResponseSchema,
  );
  return read.kind === "failed"
    ? read
    : { kind: "loaded", events: read.value.data.events };
}

export async function openBuilder(eventId: string): Promise<BuilderLoad> {
  const read = readApiPayload(
    await requestApi(eventPath(TEAM_BUILDER_API_PATH, eventId)),
    builderResponseSchema,
  );
  return read.kind === "failed"
    ? read
    : { kind: "loaded", builder: read.value.data };
}

/** El servidor reparte los "Sí" y deja el resultado guardado en borrador. */
export async function autoBalance(eventId: string): Promise<BalanceOutcome> {
  const read = readApiPayload(
    await requestApi(eventPath(TEAM_AUTO_BALANCE_API_PATH, eventId), {
      method: "POST",
    }),
    balancedResponseSchema,
  );
  if (read.kind === "failed") {
    return read;
  }
  return { kind: "balanced", split: read.value.data };
}

/** Manda el reparto entero: el nuevo sustituye al anterior (RF-4). */
export async function saveSplit(
  eventId: string,
  split: {
    readonly teams: TeamLabels;
    readonly assignments: readonly TeamAssignment[];
  },
): Promise<SaveOutcome> {
  const read = readApiPayload(
    await requestApi(eventPath(TEAM_BUILDER_API_PATH, eventId), {
      method: "PUT",
      headers: JSON_REQUEST_HEADERS,
      body: JSON.stringify(split),
    }),
    savedResponseSchema,
  );
  return read.kind === "failed" ? read : { kind: "saved" };
}

export async function publishSplit(eventId: string): Promise<PublishOutcome> {
  const read = readApiPayload(
    await requestApi(eventPath(TEAM_PUBLICATION_API_PATH, eventId), {
      method: "POST",
    }),
    publishedResponseSchema,
  );
  return read.kind === "failed"
    ? read
    : { kind: "published", ...read.value.data };
}

/** Los equipos del club (#755): los que se editan, que no son por fuerza
 * los del reparto abierto (un reparto guardado conserva los suyos, D4). */
export async function loadClubTeams(): Promise<ClubTeamsLoad> {
  const read = readApiPayload(
    await requestApi(CLUB_TEAM_LABELS_API_PATH),
    clubTeamsResponseSchema,
  );
  return read.kind === "failed"
    ? read
    : { kind: "loaded", teams: read.value.data };
}

/** Cambia el nombre y el color de los equipos del club (#755, RF-1 del PRD
 * de E28) desde el builder de un evento, que los estrena si su reparto está
 * guardado y sin publicar (D4), o publicado si se pide (#871). Responde los
 * que quedaron guardados, ya recortados, y qué pasó con ese reparto. */
export async function changeClubTeams(
  teams: TeamLabels,
  eventId: string,
  applyToPublished: boolean,
): Promise<TeamsChangeOutcome> {
  const read = readApiPayload(
    await requestApi(CLUB_TEAM_LABELS_API_PATH, {
      method: "PATCH",
      headers: JSON_REQUEST_HEADERS,
      body: JSON.stringify(
        applyToPublished
          ? { ...teams, eventId, applyToPublished }
          : { ...teams, eventId },
      ),
    }),
    clubTeamsChangeResponseSchema,
  );
  if (read.kind === "failed") {
    return read;
  }
  const { a, b, ...eventSplit } = read.value.data;
  return { kind: "changed", teams: { a, b }, ...eventSplit };
}

/** Los `reason` del 422 del builder (#401, D2). */
const BUSINESS_REASONS = {
  team_event_not_buildable: "teams.error.notBuildable",
  team_event_cancelled: "teams.error.cancelled",
  team_event_past: "teams.error.past",
  team_squad_empty: "teams.error.squadEmpty",
  team_split_empty: "teams.error.splitEmpty",
  team_player_outside_squad: "teams.error.outsideSquad",
} as const;

function isBusinessReason(
  reason: string | null,
): reason is keyof typeof BUSINESS_REASONS {
  return reason !== null && Object.hasOwn(BUSINESS_REASONS, reason);
}

/** Por qué algo del builder no salió, en el idioma de la pantalla. */
export function describeTeamsFailure(
  translate: Translator,
  { failure, reason }: TeamsFailure,
): string {
  if (failure === "business_rule" && isBusinessReason(reason)) {
    return translate(BUSINESS_REASONS[reason]);
  }
  switch (failure) {
    case "network":
      return translate("auth.error.network");
    case "not_found":
      return translate("teams.error.notFound");
    case "unauthenticated":
      return translate("teams.error.signInRequired");
    case "forbidden":
      return translate("teams.error.forbidden");
    default:
      return translate("teams.error.unexpected");
  }
}
