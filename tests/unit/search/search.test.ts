import { describe, expect, it } from "vitest";
import { MemberNotFoundError } from "@/lib/auth/account-activation";
import type { Role } from "@/lib/auth/roles";
import type { DirectoryMemberRecord } from "@/lib/directory/directory";
import type { EventVisibility } from "@/lib/events/event-agenda";
import {
  type EventMatch,
  type EventSearchQuery,
  InvalidSearchTextError,
  type NewsMatch,
  type NewsSearchQuery,
  SEARCH_GROUP_SIZE,
  SEARCH_TEXT_MAX_LENGTH,
  type SearchGateways,
  type SearchMatches,
  searchClub,
} from "@/lib/search/search";

/**
 * La búsqueda global (#425, RF-7 del PRD de E14), sin Supabase delante.
 *
 * La coincidencia sin acentos la hace la base (la prueba el test de la
 * migración); aquí se prueba lo que decide el dominio: quién ve qué, con las
 * mismas reglas que cada sección (D3), qué texto se acepta, y cómo se arman
 * los tres grupos.
 */

const CLUB_ID = "5c1ab000-0000-4000-8000-000000000001";
const CALLER_ID = "a0a0a0a0-0000-4000-8000-00000000000a";
const GROUP_ID = "90000000-0000-4000-8000-000000000009";
const POSITION_ID = "70000000-0000-4000-8000-000000000007";
/** Un jueves de Melbourne. */
const NOW = new Date("2027-07-01T02:00:00Z");
const TODAY_IN_CLUB = "2027-07-01";

function memberRecord(
  overrides: Partial<DirectoryMemberRecord> = {},
): DirectoryMemberRecord {
  return {
    userId: "cccccccc-0000-4000-8000-00000000000c",
    fullName: "Lucía Muñoz",
    country: "AU",
    experienceLevel: null,
    role: "Player",
    positionId: null,
    status: "active",
    registeredAt: "2024-03-06T01:00:00.000Z",
    aufNumber: "AUF-1",
    aufExpiry: "2028-01-01",
    isAufVerified: true,
    photoPath: null,
    isEvaluated: true,
    membershipStatus: "active",
    groupIds: [],
    email: "lucia@club.test",
    phone: null,
    emergencyContact: null,
    ...overrides,
  };
}

function eventMatch(overrides: Partial<EventMatch> = {}): EventMatch {
  return {
    id: "e0000000-0000-4000-8000-000000000001",
    title: "Scrimmage vs Geelong",
    startsOn: "2027-07-10",
    startTime: "19:00",
    location: "Piscina de Geelong",
    eventType: "competition",
    status: "scheduled",
    ...overrides,
  };
}

function newsMatch(overrides: Partial<NewsMatch> = {}): NewsMatch {
  return {
    id: "n0000000-0000-4000-8000-000000000001",
    title: "Viaje a Geelong",
    category: "announcement",
    publishedAt: "2027-06-20T00:00:00.000Z",
    ...overrides,
  };
}

function matches<Row>(rows: readonly Row[], total = rows.length) {
  return { total, rows } satisfies SearchMatches<Row>;
}

const NO_MATCHES = matches([]);

type FakeOptions = {
  readonly callerRole?: Role;
  readonly hasCaller?: boolean;
  readonly members?: readonly DirectoryMemberRecord[];
  readonly upcoming?: SearchMatches<EventMatch>;
  readonly past?: SearchMatches<EventMatch>;
  readonly news?: SearchMatches<NewsMatch>;
};

type Recorded = {
  readonly memberTexts: string[];
  readonly eventQueries: EventSearchQuery[];
  readonly newsQueries: NewsSearchQuery[];
  readonly signedPaths: string[][];
};

function fakeGateways(options: FakeOptions = {}): {
  gateways: SearchGateways;
  recorded: Recorded;
} {
  const recorded: Recorded = {
    memberTexts: [],
    eventQueries: [],
    newsQueries: [],
    signedPaths: [],
  };
  const gateways: SearchGateways = {
    members: {
      findRoleRequestMember: async () =>
        options.hasCaller === false
          ? null
          : {
              clubId: CLUB_ID,
              fullName: "Quien Busca",
              role: options.callerRole ?? "Player",
            },
    },
    memberGroups: {
      listGroupsOf: async () => [{ id: GROUP_ID, name: "Senior Squad" }],
    },
    directory: {
      findMembersMatching: async (clubId, text) => {
        expect(clubId).toBe(CLUB_ID);
        recorded.memberTexts.push(text);
        return options.members ?? [];
      },
    },
    positions: {
      findClubPositions: async () => [
        {
          id: POSITION_ID,
          names: { en: "Forward", es: "Delantero" },
          isArchived: false,
        },
      ],
    },
    photos: {
      signPhotoUrls: async (paths) => {
        recorded.signedPaths.push([...paths]);
        return new Map(paths.map((path) => [path, `https://firmada/${path}`]));
      },
    },
    events: {
      findEventsMatching: async (query) => {
        recorded.eventQueries.push(query);
        return query.period === "upcoming"
          ? (options.upcoming ?? NO_MATCHES)
          : (options.past ?? NO_MATCHES);
      },
    },
    news: {
      findNewsMatching: async (query) => {
        recorded.newsQueries.push(query);
        return options.news ?? NO_MATCHES;
      },
    },
  };
  return { gateways, recorded };
}

function search(gateways: SearchGateways, text = "geelong") {
  return searchClub(gateways, { callerId: CALLER_ID, text, now: NOW });
}

describe("socios", () => {
  it("un Player no encuentra a un socio dado de baja", async () => {
    const { gateways } = fakeGateways({
      members: [
        memberRecord({ userId: "activo", fullName: "Ana Activa" }),
        memberRecord({
          userId: "baja",
          fullName: "Ana De Baja",
          status: "inactive",
        }),
      ],
    });

    const results = await search(gateways, "ana");

    expect(results.members.items.map((item) => item.userId)).toEqual([
      "activo",
    ]);
    expect(results.members.total).toBe(1);
  });

  it("un Admin sí encuentra a un socio dado de baja", async () => {
    const { gateways } = fakeGateways({
      callerRole: "Admin",
      members: [memberRecord({ userId: "baja", status: "inactive" })],
    });

    const results = await search(gateways, "munoz");

    expect(results.members.items.map((item) => item.userId)).toEqual(["baja"]);
  });

  it("encuentra a un socio que aún no terminó su registro, como el directorio", async () => {
    const { gateways } = fakeGateways({
      members: [memberRecord({ userId: "nuevo", status: "incomplete" })],
    });

    const results = await search(gateways, "munoz");

    expect(results.members.total).toBe(1);
  });

  it("devuelve id, nombre, posición y la foto firmada, sin datos del Admin", async () => {
    const { gateways } = fakeGateways({
      callerRole: "Admin",
      members: [
        memberRecord({
          positionId: POSITION_ID,
          photoPath: "cccc/foto-thumb.webp",
        }),
      ],
    });

    const results = await search(gateways, "munoz");

    expect(results.members.items).toEqual([
      {
        kind: "member",
        userId: "cccccccc-0000-4000-8000-00000000000c",
        fullName: "Lucía Muñoz",
        position: {
          id: POSITION_ID,
          names: { en: "Forward", es: "Delantero" },
        },
        photoUrl: "https://firmada/cccc/foto-thumb.webp",
      },
    ]);
  });

  it("no firma la foto de un socio que quien busca no puede ver", async () => {
    const { gateways, recorded } = fakeGateways({
      members: [
        memberRecord({
          status: "inactive",
          photoPath: "baja/foto-thumb.webp",
        }),
      ],
    });

    await search(gateways, "munoz");

    expect(recorded.signedPaths.flat()).toEqual([]);
  });
});

describe("eventos", () => {
  it.each<Role>(["Admin", "Committee"])(
    "un %s busca en el calendario entero",
    async (callerRole) => {
      const { gateways, recorded } = fakeGateways({ callerRole });

      await search(gateways);

      expect(recorded.eventQueries.map((query) => query.visibility)).toEqual<
        EventVisibility[]
      >([{ kind: "club" }, { kind: "club" }]);
    },
  );

  it.each<Role>(["Coach", "Player"])(
    "un %s busca sólo entre los eventos de su audiencia",
    async (callerRole) => {
      const { gateways, recorded } = fakeGateways({ callerRole });

      await search(gateways);

      expect(recorded.eventQueries.map((query) => query.visibility)).toEqual<
        EventVisibility[]
      >([
        { kind: "audience", groupIds: [GROUP_ID] },
        { kind: "audience", groupIds: [GROUP_ID] },
      ]);
    },
  );

  it("busca entre los próximos y los pasados del club de quien busca", async () => {
    const { gateways, recorded } = fakeGateways();

    await search(gateways);

    expect(
      recorded.eventQueries.map(({ clubId, period, today, limit }) => ({
        clubId,
        period,
        today,
        limit,
      })),
    ).toEqual([
      {
        clubId: CLUB_ID,
        period: "upcoming",
        today: TODAY_IN_CLUB,
        limit: SEARCH_GROUP_SIZE,
      },
      {
        clubId: CLUB_ID,
        period: "past",
        today: TODAY_IN_CLUB,
        limit: SEARCH_GROUP_SIZE,
      },
    ]);
  });

  it("devuelve id, título, fecha, hora, lugar, tipo y si está cancelado", async () => {
    const { gateways } = fakeGateways({
      upcoming: matches([eventMatch({ status: "cancelled" })]),
    });

    const results = await search(gateways);

    expect(results.events.items).toEqual([
      {
        kind: "event",
        id: "e0000000-0000-4000-8000-000000000001",
        title: "Scrimmage vs Geelong",
        startsOn: "2027-07-10",
        startTime: "19:00",
        location: "Piscina de Geelong",
        eventType: "competition",
        isCancelled: true,
      },
    ]);
  });

  it("pone los próximos antes que los pasados", async () => {
    const { gateways } = fakeGateways({
      upcoming: matches([eventMatch({ id: "proximo" })]),
      past: matches([eventMatch({ id: "pasado" })]),
    });

    const results = await search(gateways);

    expect(results.events.items.map((item) => item.id)).toEqual([
      "proximo",
      "pasado",
    ]);
  });
});

describe("noticias", () => {
  it("busca con las reglas del feed: su club, él como lector y sus grupos", async () => {
    const { gateways, recorded } = fakeGateways();

    await search(gateways);

    expect(recorded.newsQueries).toEqual<NewsSearchQuery[]>([
      {
        clubId: CLUB_ID,
        readerId: CALLER_ID,
        audienceGroupIds: [GROUP_ID],
        text: "geelong",
        limit: SEARCH_GROUP_SIZE,
      },
    ]);
  });

  it("devuelve id, título, categoría y fecha de publicación", async () => {
    const { gateways } = fakeGateways({ news: matches([newsMatch()]) });

    const results = await search(gateways);

    expect(results.news.items).toEqual([
      {
        kind: "news",
        id: "n0000000-0000-4000-8000-000000000001",
        title: "Viaje a Geelong",
        category: "announcement",
        publishedAt: "2027-06-20T00:00:00.000Z",
      },
    ]);
  });
});

describe("el texto", () => {
  it.each(["", "a", "   ", " a  "])(
    "rechaza %j sin leer nada",
    async (text) => {
      const { gateways, recorded } = fakeGateways();

      await expect(search(gateways, text)).rejects.toBeInstanceOf(
        InvalidSearchTextError,
      );
      expect(recorded.memberTexts).toEqual([]);
      expect(recorded.eventQueries).toEqual([]);
    },
  );

  it("el rechazo lleva un motivo estable", async () => {
    const { gateways } = fakeGateways();

    await expect(search(gateways, "a")).rejects.toMatchObject({
      reason: "too_short",
    });
  });

  it("busca sin los espacios de los extremos", async () => {
    const { gateways, recorded } = fakeGateways();

    await search(gateways, "  geelong ");

    expect(recorded.memberTexts).toEqual(["geelong"]);
  });

  it("con más de 100 caracteres busca con los primeros 100", async () => {
    const { gateways, recorded } = fakeGateways();
    const text = `${"ñ".repeat(SEARCH_TEXT_MAX_LENGTH)}sobra`;

    await search(gateways, text);

    expect(recorded.memberTexts).toEqual(["ñ".repeat(SEARCH_TEXT_MAX_LENGTH)]);
    expect(recorded.newsQueries[0]?.text).toBe(
      "ñ".repeat(SEARCH_TEXT_MAX_LENGTH),
    );
  });

  it("quita el carácter nulo, que Postgres no admite en un texto", async () => {
    const { gateways, recorded } = fakeGateways();

    await search(gateways, "gee\u0000long");

    expect(recorded.memberTexts).toEqual(["geelong"]);
  });

  it("un texto que sólo tiene nulos y una letra es demasiado corto", async () => {
    const { gateways } = fakeGateways();

    await expect(search(gateways, "a\u0000\u0000")).rejects.toBeInstanceOf(
      InvalidSearchTextError,
    );
  });

  it("pasa comodines y comillas tal cual, como texto", async () => {
    const { gateways, recorded } = fakeGateways();

    await search(gateways, "50%_o'neil\\");

    expect(recorded.memberTexts).toEqual(["50%_o'neil\\"]);
    expect(recorded.eventQueries.map((query) => query.text)).toEqual([
      "50%_o'neil\\",
      "50%_o'neil\\",
    ]);
  });
});

describe("los grupos", () => {
  it("de siete socios devuelve los cinco primeros por nombre y el total", async () => {
    const names = ["Gil", "Abad", "Faro", "Duque", "Cano", "Egea", "Bravo"];
    const { gateways } = fakeGateways({
      members: names.map((fullName) =>
        memberRecord({ userId: fullName, fullName }),
      ),
    });

    const results = await search(gateways, "ga");

    expect(results.members.total).toBe(7);
    expect(results.members.items.map((item) => item.fullName)).toEqual([
      "Abad",
      "Bravo",
      "Cano",
      "Duque",
      "Egea",
    ]);
  });

  it("de los eventos suma los totales y corta en cinco", async () => {
    const { gateways } = fakeGateways({
      upcoming: matches(
        ["p1", "p2", "p3"].map((id) => eventMatch({ id })),
        3,
      ),
      past: matches(
        ["a1", "a2", "a3", "a4", "a5"].map((id) => eventMatch({ id })),
        9,
      ),
    });

    const results = await search(gateways);

    expect(results.events.total).toBe(12);
    expect(results.events.items.map((item) => item.id)).toEqual([
      "p1",
      "p2",
      "p3",
      "a1",
      "a2",
    ]);
  });

  it("de las noticias devuelve el total que da la base", async () => {
    const { gateways } = fakeGateways({
      news: matches([newsMatch()], 14),
    });

    const results = await search(gateways);

    expect(results.news.total).toBe(14);
  });

  it("sin coincidencias devuelve los tres grupos vacíos y en orden", async () => {
    const { gateways } = fakeGateways();

    const results = await search(gateways, "zz");

    expect(Object.keys(results)).toEqual(["members", "events", "news"]);
    expect(results).toEqual({
      members: { total: 0, items: [] },
      events: { total: 0, items: [] },
      news: { total: 0, items: [] },
    });
  });

  it("una sesión sin socio detrás no busca", async () => {
    const { gateways } = fakeGateways({ hasCaller: false });

    await expect(search(gateways)).rejects.toBeInstanceOf(MemberNotFoundError);
  });
});
