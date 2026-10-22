import { describe, expect, it } from "vitest";
import type { AccountStatus } from "@/lib/auth/account-status";
import {
  type GroupAudienceUses,
  type GroupMembershipRecord,
  countGroupUsage,
  pickPreviewMembers,
} from "@/lib/groups/group-overview";

/**
 * Lo que la lista de grupos de E32 enseña de cada uno (#826, D4 del PRD):
 * dónde se usa y a tres de sus miembros activos.
 */

const TODAY = "2026-10-22";
const YESTERDAY = "2026-10-21";
const TOMORROW = "2026-10-23";
const SENIOR = "9a9a9a9a-0000-4000-8000-000000000009";
const MASTERS = "8b8b8b8b-0000-4000-8000-000000000008";

const NO_USES: GroupAudienceUses = { events: [], series: [], posts: [] };

describe("uso de un grupo: eventos", () => {
  it("cuenta un evento suelto programado para hoy", () => {
    const uses: GroupAudienceUses = {
      ...NO_USES,
      events: [{ groupIds: [SENIOR], startsOn: TODAY, status: "scheduled" }],
    };

    expect(countGroupUsage(uses, TODAY).get(SENIOR)).toEqual({
      events: 1,
      posts: 0,
    });
  });

  it("no cuenta un evento suelto que ya pasó", () => {
    const uses: GroupAudienceUses = {
      ...NO_USES,
      events: [
        { groupIds: [SENIOR], startsOn: YESTERDAY, status: "scheduled" },
      ],
    };

    expect(countGroupUsage(uses, TODAY).get(SENIOR)).toBeUndefined();
  });

  it("no cuenta un evento suelto cancelado aunque sea futuro", () => {
    const uses: GroupAudienceUses = {
      ...NO_USES,
      events: [{ groupIds: [SENIOR], startsOn: TOMORROW, status: "cancelled" }],
    };

    expect(countGroupUsage(uses, TODAY).get(SENIOR)).toBeUndefined();
  });

  it("cuenta una serie que sigue en pie una sola vez, no por sesión", () => {
    const uses: GroupAudienceUses = {
      ...NO_USES,
      series: [{ groupIds: [SENIOR], endsOn: TOMORROW, hasSessionsLeft: true }],
    };

    expect(countGroupUsage(uses, TODAY).get(SENIOR)).toEqual({
      events: 1,
      posts: 0,
    });
  });

  it("no cuenta una serie que terminó", () => {
    const uses: GroupAudienceUses = {
      ...NO_USES,
      series: [
        { groupIds: [SENIOR], endsOn: YESTERDAY, hasSessionsLeft: true },
      ],
    };

    expect(countGroupUsage(uses, TODAY).get(SENIOR)).toBeUndefined();
  });

  it("no cuenta una serie cancelada, sin sesiones en pie de hoy en adelante", () => {
    const uses: GroupAudienceUses = {
      ...NO_USES,
      series: [
        { groupIds: [SENIOR], endsOn: TOMORROW, hasSessionsLeft: false },
      ],
    };

    expect(countGroupUsage(uses, TODAY).get(SENIOR)).toBeUndefined();
  });
});

describe("uso de un grupo: noticias", () => {
  it("cuenta la publicada y no la retirada", () => {
    const uses: GroupAudienceUses = {
      ...NO_USES,
      posts: [
        { groupIds: [SENIOR], status: "published" },
        { groupIds: [SENIOR], status: "withdrawn" },
      ],
    };

    expect(countGroupUsage(uses, TODAY).get(SENIOR)).toEqual({
      events: 0,
      posts: 1,
    });
  });
});

describe("uso de un grupo: varios grupos", () => {
  it("suma a cada grupo de la audiencia, sin tope", () => {
    const manyPosts = Array.from({ length: 12 }, () => ({
      groupIds: [SENIOR, MASTERS],
      status: "published" as const,
    }));
    const uses: GroupAudienceUses = {
      events: [{ groupIds: [MASTERS], startsOn: TODAY, status: "scheduled" }],
      series: [],
      posts: manyPosts,
    };

    const usage = countGroupUsage(uses, TODAY);

    expect(usage.get(SENIOR)).toEqual({ events: 0, posts: 12 });
    expect(usage.get(MASTERS)).toEqual({ events: 1, posts: 12 });
  });
});

function membership(
  groupId: string,
  fullName: string,
  accountStatus: AccountStatus = "active",
): GroupMembershipRecord {
  return {
    groupId,
    member: {
      id: `id-${fullName}`,
      fullName,
      accountStatus,
      photoPath: null,
    },
  };
}

describe("vista previa de un grupo", () => {
  it("elige a los tres primeros miembros activos en orden de nombre", () => {
    const memberships = [
      membership(SENIOR, "Zoe"),
      membership(SENIOR, "ana"),
      membership(SENIOR, "Bea"),
      membership(SENIOR, "Carla"),
      membership(MASTERS, "Aaron"),
    ];

    const preview = pickPreviewMembers(memberships, SENIOR);

    expect(preview.map(({ fullName }) => fullName)).toEqual([
      "ana",
      "Bea",
      "Carla",
    ]);
  });

  it("devuelve los que haya cuando son menos de tres", () => {
    const preview = pickPreviewMembers([membership(SENIOR, "Bea")], SENIOR);

    expect(preview.map(({ fullName }) => fullName)).toEqual(["Bea"]);
  });

  it("deja fuera a los pendientes de activar y a los dados de baja", () => {
    const memberships = [
      membership(SENIOR, "Ana", "incomplete"),
      membership(SENIOR, "Bea", "inactive"),
      membership(SENIOR, "Carla"),
    ];

    const preview = pickPreviewMembers(memberships, SENIOR);

    expect(preview.map(({ fullName }) => fullName)).toEqual(["Carla"]);
  });

  it("es una lista vacía para un grupo sin miembros activos", () => {
    const memberships = [membership(SENIOR, "Ana", "incomplete")];

    expect(pickPreviewMembers(memberships, SENIOR)).toEqual([]);
  });
});
