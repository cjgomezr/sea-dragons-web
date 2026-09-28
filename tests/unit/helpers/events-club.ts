import type { AccountStatus } from "@/lib/auth/account-status";
import type { Role } from "@/lib/auth/roles";
import type {
  EventAudience,
  EventDraft,
  EventGateways,
  NewEventSchedule,
} from "@/lib/events/event-creation";
import type { EventNoticeGateways } from "@/lib/events/event-creation-notice";
import type {
  NotificationBroadcastWriter,
  NotificationInsert,
} from "@/lib/notifications/notify-member";

/**
 * Un club en memoria para los tests de crear eventos (#307). El doble cumple
 * el contrato del adaptador: guarda la serie y sus ocurrencias de una vez y
 * devuelve un id por fecha, en el mismo orden. Los socios y los grupos son
 * para el aviso a la audiencia (#310).
 */

export const CALLER_ID = "a0a0a0a0-0000-4000-8000-00000000000a";
export const CLUB_ID = "5c1ab000-0000-4000-8000-000000000001";
export const SENIOR_SQUAD_ID = "9a9a9a9a-0000-4000-8000-000000000009";
export const MASTERS_SQUAD_ID = "8b8b8b8b-0000-4000-8000-000000000008";
export const SAVED_SERIES_ID = "c2c2c2c2-0000-4000-8000-00000000000c";

/** 2027-06-15 10:00 en Melbourne (hora estándar, UTC+10). */
export const NOW = new Date("2027-06-15T00:00:00Z");

export function savedEventId(index: number): string {
  return `e${String(index).padStart(7, "0")}-0000-4000-8000-00000000000e`;
}

export const SINGLE_DRAFT: Extract<EventDraft, { repeat: "none" }> = {
  title: "Liga estatal",
  eventType: "competition",
  startTime: "10:00",
  location: "MSAC",
  notes: "Llevad gorro azul.",
  audience: { kind: "groups", groupIds: [SENIOR_SQUAD_ID] },
  repeat: "none",
  startsOn: "2027-07-10",
};

export const WEEKLY_DRAFT: Extract<EventDraft, { repeat: "weekly" }> = {
  title: "Entrenamiento",
  eventType: "training",
  startTime: "19:00",
  location: "MSAC",
  notes: null,
  audience: { kind: "club" },
  repeat: "weekly",
  weekdays: [2, 4],
  startsOn: "2027-07-01",
  endsOn: "2027-08-31",
};

/** La audiencia y los avisos, que comparten crear (#310) y editar o cancelar
 * (#317). */
export type FakeNoticeOptions = {
  /** Los socios del club con el estado de su cuenta. */
  readonly clubMembers?: Readonly<Record<string, AccountStatus>>;
  /** Quién está en cada grupo. */
  readonly groupMembers?: Readonly<Record<string, readonly string[]>>;
  readonly failAudience?: boolean;
  /** Ningún aviso se guarda, ni en lote ni uno a uno. */
  readonly failNotices?: boolean;
};

export type FakeEventsClubOptions = FakeNoticeOptions & {
  readonly callerRole?: Role;
  readonly callerIsMember?: false;
  readonly clubGroupIds?: readonly string[];
};

export type FakeNotices = {
  /** Los avisos guardados, en el orden en que se escribieron. */
  readonly notices: NotificationInsert[];
  /** Cada escritura en lote, con sus filas. */
  readonly noticeBatches: (readonly NotificationInsert[])[];
};

export type FakeEventsClub = FakeNotices & {
  readonly gateways: EventGateways;
  readonly saved: NewEventSchedule[];
};

/** La audiencia como la resuelve la base: todo el club, o quien esté en
 * alguno de los grupos, sin quitar repetidos. */
function audienceOf(
  options: FakeNoticeOptions,
  audience: EventAudience,
): readonly string[] {
  if (audience.kind === "club") {
    return Object.keys(options.clubMembers ?? {});
  }
  return audience.groupIds.flatMap((id) => options.groupMembers?.[id] ?? []);
}

function createFakeNotices(
  options: FakeNoticeOptions,
  club: FakeNotices,
): NotificationBroadcastWriter {
  const failIfAsked = (): void => {
    if (options.failNotices === true) {
      throw new Error("los avisos no se pudieron guardar");
    }
  };
  return {
    findRecipients: async (userIds) =>
      new Map(
        userIds.flatMap((id) => {
          const accountStatus = options.clubMembers?.[id];
          return accountStatus === undefined
            ? []
            : [[id, { clubId: CLUB_ID, accountStatus }] as const];
        }),
      ),
    insertNotifications: async (rows) => {
      failIfAsked();
      club.noticeBatches.push(rows);
      club.notices.push(...rows);
    },
    insertNotification: async (row) => {
      failIfAsked();
      club.notices.push(row);
    },
    pruneNotificationsOf: async () => new Map(),
    runAfterResponse: () => {},
  };
}

/** La audiencia como la resuelve la base y los avisos que se guardan. */
export function fakeEventNotices(
  options: FakeNoticeOptions,
): EventNoticeGateways & FakeNotices {
  const notices: NotificationInsert[] = [];
  const noticeBatches: (readonly NotificationInsert[])[] = [];
  return {
    eventAudience: {
      findAudienceMemberIds: async ({ audience }) => {
        if (options.failAudience === true) {
          throw new Error("la audiencia no se pudo leer");
        }
        return audienceOf(options, audience);
      },
    },
    notifications: createFakeNotices(options, { notices, noticeBatches }),
    notices,
    noticeBatches,
  };
}

export function fakeEventsClub(
  options: FakeEventsClubOptions = {},
): FakeEventsClub {
  const saved: NewEventSchedule[] = [];
  const { notices, noticeBatches, ...noticeGateways } =
    fakeEventNotices(options);
  const clubGroupIds = options.clubGroupIds ?? [
    SENIOR_SQUAD_ID,
    MASTERS_SQUAD_ID,
  ];
  const gateways: EventGateways = {
    members: {
      findRoleRequestMember: async () =>
        options.callerIsMember === false
          ? null
          : {
              clubId: CLUB_ID,
              fullName: "Quien llama",
              role: options.callerRole ?? "Committee",
            },
    },
    events: {
      findClubGroupIds: async ({ clubId, groupIds }) =>
        new Set(
          clubId === CLUB_ID
            ? groupIds.filter((id) => clubGroupIds.includes(id))
            : [],
        ),
      insertSchedule: async (schedule) => {
        saved.push(schedule);
        return {
          seriesId: schedule.series === null ? null : SAVED_SERIES_ID,
          eventIds: schedule.occurrenceDates.map((_date, index) =>
            savedEventId(index),
          ),
        };
      },
    },
    ...noticeGateways,
  };
  return { gateways, saved, notices, noticeBatches };
}
