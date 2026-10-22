import { describe, expect, it } from "vitest";
import type { Role } from "@/lib/auth/roles";
import {
  type AudienceEventRecord,
  type AudiencePostRecord,
  type AudienceSeriesRecord,
  GROUP_AUDIENCE_LIMIT,
  type GroupAudienceGateways,
  type GroupAudienceRecords,
  listGroupAudience,
} from "@/lib/groups/group-audience";
import { GroupNotFoundError, GroupsForbiddenError } from "@/lib/groups/groups";

/**
 * Dónde se usa un grupo (#827, D9 del PRD de E32): los eventos sueltos
 * programados de hoy en adelante, las series sin terminar ni cancelar y las
 * noticias publicadas, hasta cinco de cada lista y con su total.
 */

const CALLER_ID = "a0a0a0a0-0000-4000-8000-00000000000a";
const CLUB_ID = "5c1ab000-0000-4000-8000-000000000001";
const GROUP_ID = "9a9a9a9a-0000-4000-8000-000000000009";
const OTHER_GROUP_ID = "8b8b8b8b-0000-4000-8000-000000000008";

/** 22 de octubre de 2026 a mediodía en Melbourne. */
const NOW = new Date("2026-10-22T01:00:00Z");
const TODAY = "2026-10-22";
const YESTERDAY = "2026-10-21";

function eventRecord(
  id: string,
  overrides: Partial<AudienceEventRecord> = {},
): AudienceEventRecord {
  return {
    id,
    title: `Evento ${id}`,
    groupIds: [GROUP_ID],
    startsOn: TODAY,
    startTime: "19:00",
    status: "scheduled",
    ...overrides,
  };
}

function seriesRecord(
  id: string,
  overrides: Partial<AudienceSeriesRecord> = {},
): AudienceSeriesRecord {
  return {
    id,
    title: `Serie ${id}`,
    groupIds: [GROUP_ID],
    weekdays: [3],
    startTime: "18:00",
    endsOn: "2026-12-16",
    nextSession: { id: `sesion-${id}`, startsOn: TODAY },
    ...overrides,
  };
}

function postRecord(
  id: string,
  overrides: Partial<AudiencePostRecord> = {},
): AudiencePostRecord {
  return {
    id,
    title: `Noticia ${id}`,
    groupIds: [GROUP_ID],
    status: "published",
    publishedAt: "2026-10-12T00:00:00.000Z",
    ...overrides,
  };
}

const NO_RECORDS: GroupAudienceRecords = { events: [], series: [], posts: [] };

type GatewayOptions = {
  readonly role?: Role;
  readonly records?: GroupAudienceRecords;
  readonly missingGroup?: true;
};

const queries: string[] = [];

function gateways(options: GatewayOptions = {}): GroupAudienceGateways {
  queries.length = 0;
  return {
    members: {
      findRoleRequestMember: async () => ({
        clubId: CLUB_ID,
        fullName: "Carla Coach",
        role: options.role ?? "Coach",
      }),
    },
    audience: {
      findGroupAudience: async ({ clubId, groupId, today }) => {
        queries.push(`${clubId} ${groupId} ${today}`);
        return options.missingGroup
          ? { kind: "group_not_found" }
          : { kind: "found", records: options.records ?? NO_RECORDS };
      },
    },
  };
}

const REQUEST = { callerId: CALLER_ID, groupId: GROUP_ID, now: NOW };

describe("audiencia de un grupo", () => {
  it("lee el grupo en el club de quien llama, con la fecha de hoy en Melbourne", async () => {
    await listGroupAudience(gateways(), REQUEST);

    expect(queries).toEqual([`${CLUB_ID} ${GROUP_ID} ${TODAY}`]);
  });

  it("responde listas vacías con total 0 a un grupo sin uso", async () => {
    await expect(listGroupAudience(gateways(), REQUEST)).resolves.toEqual({
      events: { items: [], total: 0 },
      posts: { items: [], total: 0 },
    });
  });

  it("devuelve el evento suelto con su fecha y su hora, y la serie con sus días, su hora y su próxima sesión", async () => {
    const audience = await listGroupAudience(
      gateways({
        records: {
          ...NO_RECORDS,
          events: [eventRecord("e1", { startsOn: "2026-10-24" })],
          series: [seriesRecord("s1")],
        },
      }),
      REQUEST,
    );

    expect(audience.events).toEqual({
      total: 2,
      items: [
        {
          kind: "series",
          id: "s1",
          title: "Serie s1",
          weekdays: [3],
          startTime: "18:00",
          nextSession: { id: "sesion-s1", startsOn: TODAY },
        },
        {
          kind: "event",
          id: "e1",
          title: "Evento e1",
          startsOn: "2026-10-24",
          startTime: "19:00",
        },
      ],
    });
  });

  it("deja fuera el evento pasado, el cancelado, la serie terminada y la cancelada", async () => {
    const audience = await listGroupAudience(
      gateways({
        records: {
          ...NO_RECORDS,
          events: [
            eventRecord("pasado", { startsOn: YESTERDAY }),
            eventRecord("cancelado", { status: "cancelled" }),
            eventRecord("vigente"),
          ],
          series: [
            seriesRecord("terminada", { endsOn: YESTERDAY }),
            seriesRecord("cancelada", { nextSession: null }),
          ],
        },
      }),
      REQUEST,
    );

    expect(audience.events.items.map(({ id }) => id)).toEqual(["vigente"]);
    expect(audience.events.total).toBe(1);
  });

  it("ordena los eventos por fecha y, el mismo día, por hora", async () => {
    const audience = await listGroupAudience(
      gateways({
        records: {
          ...NO_RECORDS,
          events: [
            eventRecord("sabado", { startsOn: "2026-10-24" }),
            eventRecord("hoy-tarde", { startTime: "20:00" }),
          ],
          series: [
            seriesRecord("hoy-temprano", { startTime: "07:00" }),
            seriesRecord("domingo", {
              nextSession: { id: "x", startsOn: "2026-10-25" },
            }),
          ],
        },
      }),
      REQUEST,
    );

    expect(audience.events.items.map(({ id }) => id)).toEqual([
      "hoy-temprano",
      "hoy-tarde",
      "sabado",
      "domingo",
    ]);
  });

  it(`trae como mucho ${GROUP_AUDIENCE_LIMIT} de cada lista, con el total entero`, async () => {
    const days = ["23", "24", "25", "26", "27", "28", "29"];
    const audience = await listGroupAudience(
      gateways({
        records: {
          ...NO_RECORDS,
          events: days.map((day) =>
            eventRecord(day, { startsOn: `2026-10-${day}` }),
          ),
          posts: days.map((day) =>
            postRecord(day, { publishedAt: `2026-10-${day}T00:00:00.000Z` }),
          ),
        },
      }),
      REQUEST,
    );

    expect(audience.events.total).toBe(7);
    expect(audience.events.items.map(({ id }) => id)).toEqual([
      "23",
      "24",
      "25",
      "26",
      "27",
    ]);
    expect(audience.posts.total).toBe(7);
    expect(audience.posts.items).toHaveLength(GROUP_AUDIENCE_LIMIT);
  });

  it("devuelve las noticias publicadas de la más reciente a la más antigua, con su fecha de publicación", async () => {
    const audience = await listGroupAudience(
      gateways({
        records: {
          ...NO_RECORDS,
          posts: [
            postRecord("vieja", { publishedAt: "2026-09-01T00:00:00.000Z" }),
            postRecord("nueva", { publishedAt: "2026-10-12T00:00:00.000Z" }),
          ],
        },
      }),
      REQUEST,
    );

    expect(audience.posts).toEqual({
      total: 2,
      items: [
        {
          id: "nueva",
          title: "Noticia nueva",
          publishedAt: "2026-10-12T00:00:00.000Z",
        },
        {
          id: "vieja",
          title: "Noticia vieja",
          publishedAt: "2026-09-01T00:00:00.000Z",
        },
      ],
    });
  });

  it("deja fuera la noticia retirada", async () => {
    const audience = await listGroupAudience(
      gateways({
        records: {
          ...NO_RECORDS,
          posts: [postRecord("retirada", { status: "withdrawn" })],
        },
      }),
      REQUEST,
    );

    expect(audience.posts).toEqual({ items: [], total: 0 });
  });

  it("deja fuera lo que tiene a otro grupo en su audiencia y no a este", async () => {
    const audience = await listGroupAudience(
      gateways({
        records: {
          events: [eventRecord("ajeno", { groupIds: [OTHER_GROUP_ID] })],
          series: [seriesRecord("ajena", { groupIds: [OTHER_GROUP_ID] })],
          posts: [postRecord("ajena", { groupIds: [OTHER_GROUP_ID] })],
        },
      }),
      REQUEST,
    );

    expect(audience.events.total + audience.posts.total).toBe(0);
  });

  it("rechaza un grupo que no existe, es de otro club o acaban de borrar", async () => {
    await expect(
      listGroupAudience(gateways({ missingGroup: true }), REQUEST),
    ).rejects.toBeInstanceOf(GroupNotFoundError);
  });

  it("rechaza a un Player sin leer nada", async () => {
    await expect(
      listGroupAudience(gateways({ role: "Player" }), REQUEST),
    ).rejects.toBeInstanceOf(GroupsForbiddenError);
    expect(queries).toEqual([]);
  });
});
