import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuditLogInsertRow } from "@/lib/audit/audit-log";
import type { Role } from "@/lib/auth/roles";
import {
  CLUB_SETTINGS_POSITIONS_API_PATH,
  CLUB_SETTINGS_POSITIONS_ORDER_API_PATH,
} from "@/lib/auth/routes";
import type { SessionState } from "@/lib/auth/session-boundary";
import type {
  ManagedPosition,
  ManagedPositionsGateways,
  PositionInsertResult,
} from "@/lib/club/manage-club-positions";

/**
 * Los endpoints con los que el Admin administra las posiciones (#300, RF-7
 * del PRD de E18a). La petición entra por el proxy y sólo llega al handler si
 * la frontera la deja seguir, como en producción: el 401 y el 403 son los de
 * verdad. El dominio va entero; sólo la base es un doble.
 */

const ORIGIN = "http://localhost:3417";
const CONTINUE_HEADER = "x-middleware-next";
const ADMIN_ID = "a0a0a0a0-0000-4000-8000-00000000000a";
const CLUB_ID = "5c1ab000-0000-4000-8000-000000000001";
const OTHER_CLUBS_POSITION_ID = "00000000-0000-4000-8000-000000000099";

const GOALKEEPER: ManagedPosition = {
  id: "00000000-0000-4000-8000-000000000001",
  names: { en: "Goalkeeper", es: "Portería" },
  isArchived: false,
  coverage: "goalkeeper",
  minPerTeam: 1,
  shortNames: { en: "GK", es: "POR" },
};
const DEFENDER: ManagedPosition = {
  id: "00000000-0000-4000-8000-000000000002",
  names: { en: "Defender", es: "Defensa" },
  isArchived: true,
  coverage: null,
  minPerTeam: 0,
  shortNames: { en: null, es: null },
};
const CATALOG = [GOALKEEPER, DEFENDER];
const NEW_POSITION_ID = "00000000-0000-4000-8000-000000000004";

const readSessionState = vi.fn();
const invalidateClubPositions = vi.fn();
const writes: string[] = [];
let callerRole: Role = "Admin";
let insertResult: PositionInsertResult;

function isOwnPosition(positionId: string): boolean {
  return CATALOG.some((position) => position.id === positionId);
}

function managedPositionsGateways(): ManagedPositionsGateways {
  return {
    members: {
      findRoleRequestMember: async () => ({
        clubId: CLUB_ID,
        fullName: "Ana Admin",
        role: callerRole,
      }),
    },
    positions: {
      findClubPositions: async () => CATALOG,
      insertPosition: async (_clubId, names) => {
        writes.push(`insert ${names.en ?? "-"}|${names.es ?? "-"}`);
        return insertResult;
      },
      renamePosition: async ({ positionId }, names) => {
        if (!isOwnPosition(positionId)) {
          return { kind: "not_found" };
        }
        writes.push(`rename ${names.en ?? "-"}|${names.es ?? "-"}`);
        return { kind: "renamed" };
      },
      reorderPositions: async (_clubId, positionIds) => {
        if (positionIds.length !== 1) {
          return { kind: "positions_changed" };
        }
        writes.push(`reorder ${positionIds.join(",")}`);
        return { kind: "reordered" };
      },
      setPositionArchived: async ({ positionId }, isArchived) => {
        if (!isOwnPosition(positionId)) {
          return { kind: "not_found" };
        }
        writes.push(`archive ${isArchived}`);
        return { kind: "changed" };
      },
      setPositionCoverage: async ({ positionId }, coverage) => {
        if (!isOwnPosition(positionId)) {
          return { kind: "not_found" };
        }
        writes.push(`coverage ${coverage ?? "none"}`);
        return { kind: "changed" };
      },
      setPositionMinimum: async ({ positionId }, minPerTeam) => {
        if (!isOwnPosition(positionId)) {
          return { kind: "not_found" };
        }
        writes.push(`minimum ${minPerTeam}`);
        return { kind: "changed", previous: 1 };
      },
      setPositionShortNames: async ({ positionId }, shortNames) => {
        if (!isOwnPosition(positionId)) {
          return { kind: "not_found" };
        }
        writes.push(`short ${shortNames.en ?? "-"}|${shortNames.es ?? "-"}`);
        return { kind: "changed", previous: { en: null, es: null } };
      },
    },
    audit: {
      insertAuditLogRow: async (row: AuditLogInsertRow) => {
        writes.push(`audit ${row.action}`);
        return { error: null };
      },
    },
  };
}

vi.mock("@/lib/supabase/session-client", () => ({
  readIncomingCookies: () => [],
  applySessionCookies: () => undefined,
  createSessionClient: () => ({
    kind: "ready",
    client: {},
    recorder: { recorded: () => ({ cookies: [], headers: {} }) },
  }),
}));

vi.mock("@/lib/auth/session-reader", () => ({
  readSessionState: (...args: unknown[]) => readSessionState(...args),
  readAuthenticatedUserId: async () => ADMIN_ID,
}));

vi.mock("@/lib/club/supabase-manage-club-positions", () => ({
  createSupabaseManagedPositionsGateways: () => ({
    kind: "ready",
    gateways: managedPositionsGateways(),
  }),
}));

vi.mock("@/lib/club/supabase-club-positions", () => ({
  invalidateClubPositions: () => invalidateClubPositions(),
}));

const { proxy } = await import("@/proxy");
const collection = await import("@/app/api/v1/club/settings/positions/route");
const order = await import("@/app/api/v1/club/settings/positions/order/route");
const single = await import("@/app/api/v1/club/settings/positions/[id]/route");

function givenSession(session: SessionState): void {
  if (session.kind === "active") {
    callerRole = session.role;
  }
  readSessionState.mockResolvedValue(session);
}

async function throughBoundary(
  request: NextRequest,
  handle: (request: NextRequest) => Promise<Response>,
): Promise<Response> {
  const boundaryResponse = await proxy(request);
  return boundaryResponse.headers.get(CONTINUE_HEADER) === "1"
    ? handle(request)
    : boundaryResponse;
}

function jsonRequest(
  path: string,
  method: "POST" | "PUT" | "PATCH",
  body: unknown,
): NextRequest {
  return new NextRequest(new URL(path, ORIGIN), {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function getPositions(): Promise<Response> {
  return throughBoundary(
    new NextRequest(new URL(CLUB_SETTINGS_POSITIONS_API_PATH, ORIGIN)),
    collection.GET,
  );
}

function postPosition(body: unknown): Promise<Response> {
  return throughBoundary(
    jsonRequest(CLUB_SETTINGS_POSITIONS_API_PATH, "POST", body),
    collection.POST,
  );
}

function putOrder(body: unknown): Promise<Response> {
  return throughBoundary(
    jsonRequest(CLUB_SETTINGS_POSITIONS_ORDER_API_PATH, "PUT", body),
    order.PUT,
  );
}

function patchPosition(positionId: string, body: unknown): Promise<Response> {
  return throughBoundary(
    jsonRequest(
      `${CLUB_SETTINGS_POSITIONS_API_PATH}/${positionId}`,
      "PATCH",
      body,
    ),
    (request) =>
      single.PATCH(request, { params: Promise.resolve({ id: positionId }) }),
  );
}

async function errorOf(
  response: Response,
): Promise<{ code: string; reason?: string }> {
  const body = (await response.json()) as {
    error: { code: string; reason?: string };
  };
  return body.error;
}

const VALID_NAMES = { names: { en: "Centre", es: "Centro" } };

beforeEach(() => {
  vi.clearAllMocks();
  writes.length = 0;
  insertResult = { kind: "created", positionId: NEW_POSITION_ID };
  givenSession({ kind: "active", role: "Admin", membershipCurrent: true });
});

describe("endpoints de posiciones", () => {
  describe("GET: listar", () => {
    it("responde 200 con las activas y las archivadas a un Admin", async () => {
      const response = await getPositions();

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        data: { positions: CATALOG },
      });
    });

    it("responde 401 sin sesión", async () => {
      givenSession({ kind: "anonymous" });

      const response = await getPositions();

      expect(response.status).toBe(401);
    });
  });

  describe("POST: crear", () => {
    it("responde 201 con el catálogo, anota e invalida la caché", async () => {
      const response = await postPosition(VALID_NAMES);

      expect(response.status).toBe(201);
      await expect(response.json()).resolves.toEqual({
        data: { positions: CATALOG },
      });
      expect(writes).toEqual([
        "insert Centre|Centro",
        "audit club_position.created",
      ]);
      expect(invalidateClubPositions).toHaveBeenCalledOnce();
    });

    it("acepta el nombre en un solo idioma", async () => {
      const response = await postPosition({
        names: { en: null, es: "Centro" },
      });

      expect(response.status).toBe(201);
      expect(writes[0]).toBe("insert -|Centro");
    });

    it("responde 400 junto al campo con un nombre repetido", async () => {
      insertResult = { kind: "name_taken", locale: "es" };

      const response = await postPosition(VALID_NAMES);

      expect(response.status).toBe(400);
      await expect(errorOf(response)).resolves.toEqual(
        expect.objectContaining({
          code: "validation_error",
          reason: "name_es_taken",
        }),
      );
      expect(invalidateClubPositions).not.toHaveBeenCalled();
    });

    it.each([
      ["sin ningún nombre", { names: { en: "", es: null } }, "name_required"],
      [
        "con un nombre de 41 caracteres",
        { names: { en: "a".repeat(41), es: null } },
        "name_en_too_long",
      ],
    ])("responde 400 %s", async (_case, body, reason) => {
      const response = await postPosition(body);

      expect(response.status).toBe(400);
      await expect(errorOf(response)).resolves.toMatchObject({ reason });
      expect(writes).toEqual([]);
    });

    it.each([
      ["sin nombres", {}],
      [
        "con un idioma que no existe",
        { names: { en: "A", es: null, fr: "B" } },
      ],
      ["con el nombre como número", { names: { en: 7, es: null } }],
    ])("responde 400 a un cuerpo %s", async (_case, body) => {
      const response = await postPosition(body);

      expect(response.status).toBe(400);
      expect(writes).toEqual([]);
    });
  });

  describe("PATCH: renombrar, archivar, reactivar y cambiar la función", () => {
    it("renombra, anota e invalida la caché", async () => {
      const response = await patchPosition(GOALKEEPER.id, {
        names: { en: "Keeper", es: "Portería" },
      });

      expect(response.status).toBe(200);
      expect(writes).toEqual([
        "rename Keeper|Portería",
        "audit club_position.renamed",
      ]);
      expect(invalidateClubPositions).toHaveBeenCalledOnce();
    });

    it("archiva y anota", async () => {
      const response = await patchPosition(GOALKEEPER.id, { isArchived: true });

      expect(response.status).toBe(200);
      expect(writes).toEqual(["archive true", "audit club_position.archived"]);
      expect(invalidateClubPositions).toHaveBeenCalledOnce();
    });

    it("reactiva y anota", async () => {
      const response = await patchPosition(DEFENDER.id, { isArchived: false });

      expect(response.status).toBe(200);
      expect(writes).toEqual([
        "archive false",
        "audit club_position.reactivated",
      ]);
    });

    it("cambia la función, anota e invalida la caché", async () => {
      const response = await patchPosition(GOALKEEPER.id, {
        coverage: "defender",
      });

      expect(response.status).toBe(200);
      expect(writes).toEqual([
        "coverage defender",
        "audit club_position.coverage_changed",
      ]);
      expect(invalidateClubPositions).toHaveBeenCalledOnce();
    });

    it("le quita la función con null", async () => {
      const response = await patchPosition(GOALKEEPER.id, { coverage: null });

      expect(response.status).toBe(200);
      expect(writes).toEqual([
        "coverage none",
        "audit club_position.coverage_changed",
      ]);
    });

    it("cambia el mínimo, anota e invalida la caché", async () => {
      const response = await patchPosition(GOALKEEPER.id, { minPerTeam: 2 });

      expect(response.status).toBe(200);
      expect(writes).toEqual([
        "minimum 2",
        "audit club_position.min_per_team_changed",
      ]);
      expect(invalidateClubPositions).toHaveBeenCalledOnce();
    });

    it("responde con cada posición con su mínimo y sus abreviaturas", async () => {
      const response = await patchPosition(GOALKEEPER.id, { minPerTeam: 2 });

      await expect(response.json()).resolves.toMatchObject({
        data: {
          positions: [
            { minPerTeam: 1, shortNames: { en: "GK", es: "POR" } },
            { minPerTeam: 0, shortNames: { en: null, es: null } },
          ],
        },
      });
    });

    it("cambia el mínimo de una posición archivada", async () => {
      const response = await patchPosition(DEFENDER.id, { minPerTeam: 3 });

      expect(response.status).toBe(200);
      expect(writes).toEqual([
        "minimum 3",
        "audit club_position.min_per_team_changed",
      ]);
    });

    it("cambia las abreviaturas, anota e invalida la caché", async () => {
      const response = await patchPosition(GOALKEEPER.id, {
        shortNames: { en: "LIB", es: "LÍB" },
      });

      expect(response.status).toBe(200);
      expect(writes).toEqual([
        "short LIB|LÍB",
        "audit club_position.short_names_changed",
      ]);
      expect(invalidateClubPositions).toHaveBeenCalledOnce();
    });

    it("guarda sin abreviatura el idioma que llega en blanco", async () => {
      const response = await patchPosition(GOALKEEPER.id, {
        shortNames: { en: "  ", es: "POR" },
      });

      expect(response.status).toBe(200);
      expect(writes[0]).toBe("short -|POR");
    });

    it.each([
      ["menor que 0", -1, "min_per_team_out_of_range"],
      ["mayor que 20", 21, "min_per_team_out_of_range"],
      ["no entero", 1.5, "min_per_team_out_of_range"],
    ])("responde 400 a un mínimo %s", async (_case, minPerTeam, reason) => {
      const response = await patchPosition(GOALKEEPER.id, { minPerTeam });

      expect(response.status).toBe(400);
      await expect(errorOf(response)).resolves.toMatchObject({ reason });
      expect(writes).toEqual([]);
    });

    it("responde 400 junto al idioma con una abreviatura de 5 caracteres", async () => {
      const response = await patchPosition(GOALKEEPER.id, {
        shortNames: { en: "GOALK", es: null },
      });

      expect(response.status).toBe(400);
      await expect(errorOf(response)).resolves.toMatchObject({
        reason: "short_name_en_too_long",
      });
      expect(writes).toEqual([]);
    });

    it.each([
      ["el archivo", { isArchived: true }],
      ["la función", { coverage: "forward" }],
      ["el mínimo", { minPerTeam: 2 }],
      ["las abreviaturas", { shortNames: { en: "LIB", es: null } }],
    ])(
      "responde 404 al cambiar %s de una posición de otro club",
      async (_case, body) => {
        const response = await patchPosition(OTHER_CLUBS_POSITION_ID, body);

        expect(response.status).toBe(404);
        expect(writes).toEqual([]);
      },
    );

    it("responde 404 con un id que no es un uuid", async () => {
      const response = await patchPosition("no-es-un-id", { isArchived: true });

      expect(response.status).toBe(404);
    });

    it.each([
      ["vacío", {}],
      ["con nombres y archivo a la vez", { ...VALID_NAMES, isArchived: true }],
      ["con el archivo como texto", { isArchived: "true" }],
      ["con una función fuera de las tres", { coverage: "midfielder" }],
      ["con la función en español", { coverage: "Portero" }],
      [
        "con la función y el archivo a la vez",
        { coverage: "forward", isArchived: true },
      ],
      [
        "con el mínimo y las abreviaturas a la vez",
        { minPerTeam: 2, shortNames: { en: "LIB", es: null } },
      ],
      [
        "con el mínimo y la función a la vez",
        { minPerTeam: 2, coverage: null },
      ],
      ["con el mínimo como texto", { minPerTeam: "2" }],
      ["con una abreviatura sin el otro idioma", { shortNames: { en: "LIB" } }],
    ])("responde 400 a un cuerpo %s", async (_case, body) => {
      const response = await patchPosition(GOALKEEPER.id, body);

      expect(response.status).toBe(400);
      expect(writes).toEqual([]);
    });
  });

  describe("PUT order: reordenar", () => {
    it("reordena con la lista entera, anota e invalida la caché", async () => {
      const response = await putOrder({ positionIds: [GOALKEEPER.id] });

      expect(response.status).toBe(200);
      expect(writes).toEqual([
        `reorder ${GOALKEEPER.id}`,
        "audit club_position.reordered",
      ]);
      expect(invalidateClubPositions).toHaveBeenCalledOnce();
    });

    it("responde 409 si las activas cambiaron entretanto", async () => {
      const response = await putOrder({
        positionIds: [GOALKEEPER.id, DEFENDER.id],
      });

      expect(response.status).toBe(409);
      await expect(errorOf(response)).resolves.toMatchObject({
        code: "conflict",
        reason: "club_positions_changed",
      });
    });

    it.each([
      ["sin la lista", {}],
      ["con algo que no es un id", { positionIds: ["portero"] }],
    ])("responde 400 a un cuerpo %s", async (_case, body) => {
      const response = await putOrder(body);

      expect(response.status).toBe(400);
      expect(writes).toEqual([]);
    });
  });

  describe("quién puede", () => {
    it.each(["Coach", "Committee", "Player"] as const)(
      "responde 403 a un %s en cada endpoint, sin escribir nada",
      async (role) => {
        givenSession({ kind: "active", role, membershipCurrent: true });

        const responses = [
          await getPositions(),
          await postPosition(VALID_NAMES),
          await patchPosition(GOALKEEPER.id, VALID_NAMES),
          await patchPosition(GOALKEEPER.id, { isArchived: true }),
          await patchPosition(GOALKEEPER.id, { coverage: "forward" }),
          await patchPosition(GOALKEEPER.id, { minPerTeam: 2 }),
          await patchPosition(GOALKEEPER.id, {
            shortNames: { en: "LIB", es: null },
          }),
          await putOrder({ positionIds: [GOALKEEPER.id] }),
        ];

        expect(responses.map((response) => response.status)).toEqual([
          403, 403, 403, 403, 403, 403, 403, 403,
        ]);
        expect(writes).toEqual([]);
      },
    );

    it.each(["Coach", "Committee", "Player"] as const)(
      "el handler también responde 403 a un %s que se salte la frontera",
      async (role) => {
        callerRole = role;

        const response = await collection.POST(
          jsonRequest(CLUB_SETTINGS_POSITIONS_API_PATH, "POST", VALID_NAMES),
        );

        expect(response.status).toBe(403);
        expect(writes).toEqual([]);
      },
    );
  });
});
