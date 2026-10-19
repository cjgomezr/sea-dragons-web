import { z } from "zod";
import {
  agendaEventSchema,
  audienceSchema,
} from "@/components/calendar/agenda-client";
import {
  positionSchema,
  publishedTeamSchema,
} from "@/components/calendar/event-team-client";
import { ATTENDANCE_STATUSES } from "@/lib/attendance/attendance-status";
import { MEMBERSHIP_TYPES } from "@/lib/auth/registration";
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

/** Lo que llega de una noticia al inicio reducido (D2 de E27). */
const restrictedNewsItemSchema = z.object({
  id: z.uuid(),
  category: z.enum(NEWS_CATEGORIES),
  title: z.string(),
  publishedAt: z.iso.datetime({ offset: true }),
});

const memberNewsItemSchema = restrictedNewsItemSchema.extend({
  coverUrl: z.url().nullable(),
  excerpt: z.string(),
  isPinned: z.boolean(),
  isUnread: z.boolean(),
});

function latestNewsSchemaOf<Item extends z.ZodType>(item: Item) {
  return z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("news"), posts: z.array(item) }),
    unavailableSchema,
  ]);
}

const nextUpEventSchema = agendaEventSchema
  .pick({
    id: true,
    title: true,
    eventType: true,
    startsOn: true,
    endsOn: true,
    startTime: true,
    endTime: true,
    location: true,
    place: true,
    goingCount: true,
    maybeCount: true,
    myResponse: true,
  })
  .extend({
    kind: z.literal("event"),
    coverUrl: z.url().nullable(),
    audience: audienceSchema,
    myTeam: publishedTeamSchema
      .pick({ name: true, color: true })
      .extend({ position: positionSchema.nullable() })
      .nullable(),
    // Sólo a Admin y Coach (RF-2 de E27).
    teamsStatus: z.enum(["none", "draft", "published"]).optional(),
  });

const nextUpSchema = z.discriminatedUnion("kind", [
  nextUpEventSchema,
  z.object({ kind: z.literal("none") }),
  unavailableSchema,
]);

const weekSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("week"),
    events: z.array(
      agendaEventSchema.pick({
        id: true,
        title: true,
        eventType: true,
        startsOn: true,
        endsOn: true,
        startTime: true,
        endTime: true,
        location: true,
        myResponse: true,
      }),
    ),
  }),
  unavailableSchema,
]);

const membershipBlockSchema = z.enum(["pending", "past_due", "cancelled"]);

const activeMembershipSchema = z.object({
  status: z.literal("active"),
  plan: z.enum(MEMBERSHIP_TYPES).nullable(),
  renewsOn: z.iso.date().nullable(),
});

const restrictedMembershipSchema = z.object({
  status: z.literal("restricted"),
  block: membershipBlockSchema,
  endedOn: z.iso.date().nullable(),
});

const viewerSchema = z.object({ firstName: z.string() });

const contactReminderSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("reminder"),
    reminder: z.enum(["none", "phone", "emergency_contact", "both"]),
  }),
  unavailableSchema,
]);

/** "Mi asistencia" de la temporada (#746, D13). */
const meSchema = z.object({
  attendance: z.union([
    z.object({
      percent: percentSchema,
      attended: countSchema,
      sessions: countSchema,
      last10: z.array(
        z.object({
          eventId: z.string(),
          startsOn: z.iso.date(),
          status: z.enum(ATTENDANCE_STATUSES),
        }),
      ),
    }),
    z.null(),
    unavailableSchema,
  ]),
});

const todoSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("role_requests"), count: countSchema }),
  z.object({
    kind: z.literal("attendance_missing"),
    eventId: z.string(),
    title: z.string(),
    startsOn: z.iso.date(),
  }),
  z.object({
    kind: z.literal("teams_unpublished"),
    eventId: z.string(),
    title: z.string(),
  }),
  z.object({
    kind: z.literal("no_reply"),
    eventId: z.string(),
    title: z.string(),
    count: countSchema,
  }),
]);

const clubNumbersSchema = z.object({
  attendance: z.union([
    z.object({
      percent: percentSchema.nullable(),
      previousPercent: percentSchema.nullable(),
    }),
    unavailableSchema,
  ]),
  members: z.union([
    z.object({ active: countSchema, joinedThisMonth: countSchema }),
    unavailableSchema,
  ]),
  unreadNews: z.union([
    z.object({ count: countSchema, announcements: countSchema }),
    unavailableSchema,
  ]),
});

const memberDashboardBaseSchema = z.object({
  kind: z.literal("member"),
  viewer: viewerSchema,
  me: meSchema,
  tiles: z.object({
    attendance: attendanceTileSchema,
    members: membersTileSchema,
    nextTraining: nextTrainingTileSchema,
    unreadNews: unreadNewsTileSchema,
  }),
  upcomingEvents: upcomingEventsSchema,
  latestNews: latestNewsSchemaOf(memberNewsItemSchema),
  contactReminder: contactReminderSchema,
  nextUp: nextUpSchema,
  week: weekSchema,
  membership: activeMembershipSchema,
});

/** La columna de gestión sólo llega a Admin, Coach y Committee (D3). */
const memberDashboardSchema = z.discriminatedUnion("column", [
  memberDashboardBaseSchema.extend({ column: z.literal("player") }),
  memberDashboardBaseSchema.extend({
    column: z.literal("management"),
    todos: z.union([z.array(todoSchema), unavailableSchema]),
    club: clubNumbersSchema,
  }),
]);

/** El de quien no tiene la membresía al día (#453). */
const restrictedDashboardSchema = z.object({
  kind: z.literal("restricted"),
  viewer: viewerSchema,
  me: meSchema,
  block: membershipBlockSchema,
  nextTraining: nextTrainingTileSchema,
  contactReminder: contactReminderSchema,
  nextUp: nextUpSchema,
  week: weekSchema,
  membership: restrictedMembershipSchema,
  latestNews: latestNewsSchemaOf(restrictedNewsItemSchema),
});

const dashboardResponseSchema = z.object({
  data: z.discriminatedUnion("kind", [
    memberDashboardSchema,
    restrictedDashboardSchema,
  ]),
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
