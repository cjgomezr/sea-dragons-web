import { afterEach, describe, expect, it, vi } from "vitest";
import { type EventDraft, createEvents } from "@/lib/events/event-creation";
import {
  CALLER_ID,
  CLUB_ID,
  MASTERS_SQUAD_ID,
  NOW,
  SAVED_SERIES_ID,
  SENIOR_SQUAD_ID,
  SINGLE_DRAFT,
  WEEKLY_DRAFT,
  type FakeEventsClub,
  type FakeEventsClubOptions,
  fakeEventsClub,
  savedEventId,
} from "../helpers/events-club";

/**
 * El aviso a la audiencia cuando se crea un evento o una serie (#310, RF-10
 * del PRD de E7, FR-037, AC-013). Va por la puerta única de avisos después de
 * guardar, y su fallo nunca tumba la creación.
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

const TO_WHOLE_CLUB: EventDraft = {
  ...SINGLE_DRAFT,
  audience: { kind: "club" },
};

async function createAs(
  draft: EventDraft,
  options: FakeEventsClubOptions = {},
): Promise<FakeEventsClub> {
  const club = fakeEventsClub({ clubMembers: CLUB_MEMBERS, ...options });
  await createEvents(club.gateways, { callerId: CALLER_ID, draft, now: NOW });
  return club;
}

function notifiedIn(club: FakeEventsClub): string[] {
  return club.notices.map((notice) => notice.userId);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("crear evento avisa", () => {
  it("avisa a cada miembro activo del grupo y a nadie fuera de él", async () => {
    const club = await createAs(SINGLE_DRAFT, {
      groupMembers: {
        [SENIOR_SQUAD_ID]: [ANA, BEA],
        [MASTERS_SQUAD_ID]: [CARO],
      },
    });

    expect(notifiedIn(club)).toEqual([ANA, BEA]);
  });

  it("guarda el título, el tipo, la fecha y la hora como datos del aviso", async () => {
    const club = await createAs(SINGLE_DRAFT, {
      groupMembers: { [SENIOR_SQUAD_ID]: [ANA] },
    });

    expect(club.notices).toEqual([
      {
        clubId: CLUB_ID,
        userId: ANA,
        type: "event_created",
        data: {
          eventId: savedEventId(0),
          title: "Liga estatal",
          eventType: "competition",
          startsOn: "2027-07-10",
          startTime: "10:00",
        },
      },
    ]);
  });

  it("avisa a cada miembro activo del club cuando el evento es para todos", async () => {
    const club = await createAs(TO_WHOLE_CLUB);

    expect(notifiedIn(club)).toEqual([ANA, BEA, CARO]);
  });

  it("avisa una sola vez de la serie, con sus días y su rango, no una por ocurrencia", async () => {
    const club = await createAs(WEEKLY_DRAFT, {
      clubMembers: { [ANA]: "active" },
    });

    expect(club.notices).toEqual([
      {
        clubId: CLUB_ID,
        userId: ANA,
        type: "event_series_created",
        data: {
          seriesId: SAVED_SERIES_ID,
          title: "Entrenamiento",
          eventType: "training",
          weekdays: [2, 4],
          startsOn: "2027-07-01",
          endsOn: "2027-08-31",
          startTime: "19:00",
        },
      },
    ]);
  });

  it("no avisa a quien crea el evento aunque esté en la audiencia", async () => {
    const club = await createAs(TO_WHOLE_CLUB);

    expect(notifiedIn(club)).not.toContain(CALLER_ID);
  });

  it("no avisa a un miembro inactive de un grupo de la audiencia", async () => {
    const club = await createAs(SINGLE_DRAFT, {
      clubMembers: { ...CLUB_MEMBERS, [BEA]: "inactive" },
      groupMembers: { [SENIOR_SQUAD_ID]: [ANA, BEA] },
    });

    expect(notifiedIn(club)).toEqual([ANA]);
  });

  it("avisa una sola vez a quien está en dos de los grupos", async () => {
    const club = await createAs(
      {
        ...SINGLE_DRAFT,
        audience: {
          kind: "groups",
          groupIds: [SENIOR_SQUAD_ID, MASTERS_SQUAD_ID],
        },
      },
      {
        groupMembers: {
          [SENIOR_SQUAD_ID]: [ANA, BEA],
          [MASTERS_SQUAD_ID]: [ANA, CARO],
        },
      },
    );

    expect(notifiedIn(club)).toEqual([ANA, BEA, CARO]);
  });

  it("guarda los avisos de una audiencia de cien miembros en una sola escritura", async () => {
    const hundredMembers = Object.fromEntries(
      Array.from({ length: 100 }, (_unused, index) => [
        `f${String(index).padStart(7, "0")}-0000-4000-8000-00000000000f`,
        "active" as const,
      ]),
    );

    const club = await createAs(TO_WHOLE_CLUB, { clubMembers: hundredMembers });

    expect(club.noticeBatches).toHaveLength(1);
    expect(club.noticeBatches[0]).toHaveLength(100);
  });
});

describe("crear evento cuando el aviso falla", () => {
  it("deja el evento creado y registra el error cuando no se guardan los avisos", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const club = fakeEventsClub({
      clubMembers: CLUB_MEMBERS,
      failNotices: true,
    });

    const created = await createEvents(club.gateways, {
      callerId: CALLER_ID,
      draft: TO_WHOLE_CLUB,
      now: NOW,
    });

    expect(created.repeat).toBe("none");
    expect(club.saved).toHaveLength(1);
    expect(club.notices).toEqual([]);
    expect(logged).toHaveBeenCalled();
  });

  it("deja el evento creado y registra el error cuando no se puede leer la audiencia", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const club = fakeEventsClub({
      clubMembers: CLUB_MEMBERS,
      failAudience: true,
    });

    const created = await createEvents(club.gateways, {
      callerId: CALLER_ID,
      draft: TO_WHOLE_CLUB,
      now: NOW,
    });

    expect(created.repeat).toBe("none");
    expect(club.notices).toEqual([]);
    expect(logged).toHaveBeenCalled();
  });

  it("no avisa a nadie cuando la creación se rechaza", async () => {
    const club = fakeEventsClub({ clubMembers: CLUB_MEMBERS });

    const attempt = createEvents(club.gateways, {
      callerId: CALLER_ID,
      draft: { ...TO_WHOLE_CLUB, title: "" },
      now: NOW,
    });

    await expect(attempt).rejects.toThrow();
    expect(club.notices).toEqual([]);
  });
});
