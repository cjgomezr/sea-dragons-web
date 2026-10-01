import { z } from "zod";
import { agendaEventSchema } from "@/components/calendar/agenda-client";
import {
  type ApiRequestFailure,
  readApiPayload,
  requestApi,
} from "@/lib/api/request-api";
import { DASHBOARD_API_PATH } from "@/lib/auth/routes";
import type { Dashboard } from "@/lib/dashboard/dashboard";
import type { Translator } from "@/lib/i18n/translator";
import { NEWS_CATEGORIES } from "@/lib/news/news-posts";

/**
 * Lo que la pantalla de inicio (#426) le pide a `GET /api/v1/dashboard`
 * (#424) y cómo lo reduce a algo que pintar. Una sola petición, la misma que
 * hará la aplicación nativa de Release 2 (CON-002). De un error se guarda el
 * código y no la frase, para que el aviso cambie con el idioma (E17).
 */

const unavailableSchema = z.object({ kind: z.literal("unavailable") });

const noDataSchema = z.object({ kind: z.literal("no_data") });

const percentSchema = z.number().min(0).max(100);
const countSchema = z.number().int().nonnegative();

const attendanceTileSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("club_rate"),
    rate: z.discriminatedUnion("kind", [
      z.object({
        kind: z.literal("rate"),
        percent: percentSchema,
        records: countSchema,
      }),
      noDataSchema,
    ]),
  }),
  z.object({
    kind: z.literal("own_attendance"),
    attendance: z.discriminatedUnion("kind", [
      z.object({
        kind: z.literal("rate"),
        percent: percentSchema,
        sessions: countSchema,
      }),
      noDataSchema,
    ]),
  }),
  unavailableSchema,
]);

const membersTileSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("members"),
    active: countSchema,
    joinedRecently: countSchema,
  }),
  unavailableSchema,
]);

const nextTrainingTileSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("training"),
    training: agendaEventSchema.pick({
      id: true,
      title: true,
      startsOn: true,
      startTime: true,
      location: true,
      goingCount: true,
      maybeCount: true,
      myResponse: true,
    }),
  }),
  z.object({ kind: z.literal("none") }),
  unavailableSchema,
]);

const unreadNewsTileSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("unread"),
    count: countSchema,
    announcements: countSchema,
  }),
  unavailableSchema,
]);

const upcomingEventsSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("events"), events: z.array(agendaEventSchema) }),
  unavailableSchema,
]);

const latestNewsSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("news"),
    posts: z.array(
      z.object({
        id: z.uuid(),
        category: z.enum(NEWS_CATEGORIES),
        title: z.string(),
        publishedAt: z.iso.datetime({ offset: true }),
      }),
    ),
  }),
  unavailableSchema,
]);

const dashboardResponseSchema = z.object({
  data: z.object({
    viewer: z.object({ firstName: z.string() }),
    tiles: z.object({
      attendance: attendanceTileSchema,
      members: membersTileSchema,
      nextTraining: nextTrainingTileSchema,
      unreadNews: unreadNewsTileSchema,
    }),
    upcomingEvents: upcomingEventsSchema,
    latestNews: latestNewsSchema,
  }),
});

export type DashboardFailure = ApiRequestFailure;

export type DashboardLoad =
  { readonly kind: "loaded"; readonly dashboard: Dashboard } | DashboardFailure;

/** El dashboard de quien mira. Nunca rechaza: un fallo de red sale como
 * fallo. Que el esquema y el tipo del dominio no se separen lo comprueba el
 * compilador: la respuesta leída tiene que caber en `Dashboard`. */
export async function loadDashboard(): Promise<DashboardLoad> {
  const read = readApiPayload(
    await requestApi(DASHBOARD_API_PATH),
    dashboardResponseSchema,
  );
  return read.kind === "failed"
    ? read
    : { kind: "loaded", dashboard: read.value.data };
}

/** Por qué no cargó el inicio, en el idioma de la pantalla. */
export function describeDashboardFailure(
  translate: Translator,
  { failure }: DashboardFailure,
): string {
  switch (failure) {
    case "network":
      return translate("auth.error.network");
    case "unauthenticated":
      return translate("dashboard.error.signInRequired");
    default:
      return translate("dashboard.error.unexpected");
  }
}
