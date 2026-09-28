import { afterEach, describe, expect, it, vi } from "vitest";
import { isNoticeworthyChange } from "@/lib/events/event-change-notice";
import {
  type EventEdit,
  cancelEvent,
  editEvent,
} from "@/lib/events/event-management";
import {
  type SeriesEdit,
  cancelSeries,
  editSeries,
} from "@/lib/events/series-management";
import type { FakeNoticeOptions, FakeNotices } from "../helpers/events-club";
import {
  CALLER_ID,
  CLUB_ID,
  CANCELLED_EVENT_ID,
  FIRST_OCCURRENCE_ID,
  MASTERS_SQUAD_ID,
  NOW,
  SENIOR_SQUAD_ID,
  SINGLE_EVENT,
  SINGLE_EVENT_ID,
  type FakeManagedEventsClub,
  fakeManagedEventsClub,
} from "../helpers/managed-events-club";
import {
  SERIES_ID,
  type FakeManagedSeriesClub,
  fakeManagedSeriesClub,
} from "../helpers/managed-series-club";

/**
 * El aviso a la audiencia cuando un evento, una ocurrencia o una serie
 * cambian de fecha, hora o lugar, o se cancelan (#317, RF-13 del PRD de E7).
 * Va por la puerta única de avisos después de guardar, y su fallo nunca
 * deshace el cambio.
 */

const ANA = "a1000000-0000-4000-8000-000000000001";
const BEA = "b2000000-0000-4000-8000-000000000002";
const CARO = "c3000000-0000-4000-8000-000000000003";

const CLUB_MEMBERS = {
  [CALLER_ID]: "active",
  [ANA]: "active",
  [BEA]: "active",
  [CARO]: "active",
} as const;

const SQUADS = {
  [SENIOR_SQUAD_ID]: [ANA, BEA],
  [MASTERS_SQUAD_ID]: [CARO],
};

const NOTICE_OPTIONS: FakeNoticeOptions = {
  clubMembers: CLUB_MEMBERS,
  groupMembers: SQUADS,
};

function notifiedIn(club: FakeNotices): string[] {
  return club.notices.map((notice) => notice.userId);
}

async function editAs(
  changes: EventEdit,
  options: FakeNoticeOptions = NOTICE_OPTIONS,
  eventId = SINGLE_EVENT_ID,
): Promise<FakeManagedEventsClub> {
  const club = fakeManagedEventsClub(options);
  await editEvent(club.gateways, {
    callerId: CALLER_ID,
    eventId,
    changes,
    now: NOW,
  });
  return club;
}

async function editSeriesAs(
  changes: SeriesEdit,
  options: FakeNoticeOptions = NOTICE_OPTIONS,
): Promise<FakeManagedSeriesClub> {
  const club = fakeManagedSeriesClub(options);
  await editSeries(club.gateways, {
    callerId: CALLER_ID,
    seriesId: SERIES_ID,
    changes,
  });
  return club;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("qué cambios avisan", () => {
  const BEFORE = {
    startsOn: "2027-07-10",
    startTime: "10:00",
    location: "MSAC",
  };

  it.each([
    ["la fecha", { startsOn: "2027-07-11" }],
    ["la hora", { startTime: "11:30" }],
    ["el lugar", { location: "Aquatic Centre" }],
  ])("avisa cuando cambia %s", (_field, change) => {
    expect(isNoticeworthyChange(BEFORE, { ...BEFORE, ...change })).toBe(true);
  });

  it("no avisa cuando la fecha, la hora y el lugar se quedan igual", () => {
    expect(isNoticeworthyChange(BEFORE, { ...BEFORE })).toBe(false);
  });

  it("no avisa cuando cambian el título, el tipo, las notas o la audiencia", () => {
    const before = { ...SINGLE_EVENT };
    const after = {
      ...SINGLE_EVENT,
      title: "Otra liga",
      eventType: "social" as const,
      notes: "Otras notas",
      audience: { kind: "club" as const },
    };

    expect(isNoticeworthyChange(before, after)).toBe(false);
  });
});

describe("avisos de cambio y cancelación", () => {
  it("avisa a cada miembro activo de la audiencia con el título y la hora nueva", async () => {
    const club = await editAs({ startTime: "11:30" });

    expect(club.notices).toEqual(
      [ANA, BEA].map((userId) => ({
        clubId: CLUB_ID,
        userId,
        type: "event_changed",
        data: {
          eventId: SINGLE_EVENT_ID,
          title: "Liga estatal",
          startsOn: "2027-07-10",
          startTime: "11:30",
          location: "MSAC",
        },
      })),
    );
  });

  it("avisa del lugar nuevo de un evento", async () => {
    const club = await editAs({ location: "Aquatic Centre" });

    expect(club.notices[0]?.data).toMatchObject({ location: "Aquatic Centre" });
  });

  it("avisa a la audiencia de una ocurrencia cuando cambia su fecha", async () => {
    const club = await editAs(
      { startsOn: "2027-07-07" },
      NOTICE_OPTIONS,
      FIRST_OCCURRENCE_ID,
    );

    expect(notifiedIn(club)).toEqual([ANA, BEA, CARO]);
    expect(club.notices[0]).toMatchObject({
      type: "event_changed",
      data: { eventId: FIRST_OCCURRENCE_ID, startsOn: "2027-07-07" },
    });
  });

  it("no avisa a un miembro inactive de la audiencia", async () => {
    const club = await editAs(
      { startTime: "11:30" },
      {
        ...NOTICE_OPTIONS,
        clubMembers: { ...CLUB_MEMBERS, [BEA]: "inactive" },
      },
    );

    expect(notifiedIn(club)).toEqual([ANA]);
  });

  it("no avisa cuando cambian sólo el título, el tipo o las notas", async () => {
    const club = await editAs({
      title: "Otra liga",
      eventType: "social",
      notes: "Otras notas",
    });

    expect(club.event(SINGLE_EVENT_ID)?.title).toBe("Otra liga");
    expect(club.notices).toEqual([]);
  });

  it("no avisa cuando la hora que llega es la que ya tenía", async () => {
    const club = await editAs({ startTime: "10:00", location: "MSAC" });

    expect(club.notices).toEqual([]);
  });

  it("no avisa a nadie cuando cambia sólo la audiencia", async () => {
    const club = await editAs({
      audience: { kind: "groups", groupIds: [MASTERS_SQUAD_ID] },
    });

    expect(club.notices).toEqual([]);
  });

  it("avisa a la audiencia nueva cuando cambian la audiencia y la hora", async () => {
    const club = await editAs({
      audience: { kind: "groups", groupIds: [MASTERS_SQUAD_ID] },
      startTime: "11:30",
    });

    expect(notifiedIn(club)).toEqual([CARO]);
  });

  it("no avisa a quien hizo el cambio aunque esté en la audiencia", async () => {
    const club = await editAs(
      { startTime: "11:30" },
      NOTICE_OPTIONS,
      FIRST_OCCURRENCE_ID,
    );

    expect(notifiedIn(club)).not.toContain(CALLER_ID);
  });

  it("no avisa a nadie cuando la edición se rechaza", async () => {
    const club = fakeManagedEventsClub(NOTICE_OPTIONS);

    const attempt = editEvent(club.gateways, {
      callerId: CALLER_ID,
      eventId: CANCELLED_EVENT_ID,
      changes: { startTime: "11:30" },
      now: NOW,
    });

    await expect(attempt).rejects.toThrow();
    expect(club.notices).toEqual([]);
  });

  it("avisa de la cancelación de un evento con el título y la fecha", async () => {
    const club = fakeManagedEventsClub(NOTICE_OPTIONS);

    await cancelEvent(club.gateways, {
      callerId: CALLER_ID,
      eventId: SINGLE_EVENT_ID,
      now: NOW,
    });

    expect(club.notices).toEqual(
      [ANA, BEA].map((userId) => ({
        clubId: CLUB_ID,
        userId,
        type: "event_cancelled",
        data: {
          eventId: SINGLE_EVENT_ID,
          title: "Liga estatal",
          startsOn: "2027-07-10",
          startTime: "10:00",
        },
      })),
    );
  });

  it("avisa una sola vez de la serie cuando cambia su hora, no una por ocurrencia", async () => {
    const club = await editSeriesAs({ startTime: "18:00" });

    expect(club.noticeBatches).toHaveLength(1);
    expect(club.notices).toEqual(
      [ANA, BEA, CARO].map((userId) => ({
        clubId: CLUB_ID,
        userId,
        type: "event_series_changed",
        data: {
          seriesId: SERIES_ID,
          title: "Entrenamiento",
          weekdays: [2, 4],
          startTime: "18:00",
          location: "MSAC",
        },
      })),
    );
  });

  it("avisa del lugar nuevo de una serie", async () => {
    const club = await editSeriesAs({ location: "Aquatic Centre" });

    expect(club.notices[0]?.data).toMatchObject({ location: "Aquatic Centre" });
  });

  it("no avisa cuando a la serie le cambian sólo las notas", async () => {
    const club = await editSeriesAs({ notes: "Piscina 2" });

    expect(club.notices).toEqual([]);
  });

  it("avisa una sola vez de la cancelación de la serie", async () => {
    const club = fakeManagedSeriesClub(NOTICE_OPTIONS);

    await cancelSeries(club.gateways, {
      callerId: CALLER_ID,
      seriesId: SERIES_ID,
      now: NOW,
    });

    expect(club.notices).toEqual(
      [ANA, BEA, CARO].map((userId) => ({
        clubId: CLUB_ID,
        userId,
        type: "event_series_cancelled",
        data: {
          seriesId: SERIES_ID,
          title: "Entrenamiento",
          weekdays: [2, 4],
          startTime: "19:00",
        },
      })),
    );
  });
});

describe("avisos de cambio y cancelación cuando guardarlos falla", () => {
  const FAILING: FakeNoticeOptions = { ...NOTICE_OPTIONS, failNotices: true };

  it("deja el evento cambiado y registra el error", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    const club = await editAs({ startTime: "11:30" }, FAILING);

    expect(club.event(SINGLE_EVENT_ID)?.startTime).toBe("11:30");
    expect(club.notices).toEqual([]);
    expect(logged).toHaveBeenCalled();
  });

  it("deja el evento cambiado cuando no se puede leer la audiencia", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    const club = await editAs(
      { startTime: "11:30" },
      { ...NOTICE_OPTIONS, failAudience: true },
    );

    expect(club.event(SINGLE_EVENT_ID)?.startTime).toBe("11:30");
    expect(logged).toHaveBeenCalled();
  });

  it("deja el evento cancelado y registra el error", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const club = fakeManagedEventsClub(FAILING);

    const cancelled = await cancelEvent(club.gateways, {
      callerId: CALLER_ID,
      eventId: SINGLE_EVENT_ID,
      now: NOW,
    });

    expect(cancelled.status).toBe("cancelled");
    expect(logged).toHaveBeenCalled();
  });

  it("deja la serie cambiada y registra el error", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    const club = await editSeriesAs({ startTime: "18:00" }, FAILING);

    expect(club.series(SERIES_ID)?.startTime).toBe("18:00");
    expect(logged).toHaveBeenCalled();
  });

  it("deja la serie cancelada y registra el error", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const club = fakeManagedSeriesClub(FAILING);

    const cancelled = await cancelSeries(club.gateways, {
      callerId: CALLER_ID,
      seriesId: SERIES_ID,
      now: NOW,
    });

    expect(cancelled.cancelledOccurrences).toBeGreaterThan(0);
    expect(logged).toHaveBeenCalled();
  });
});
