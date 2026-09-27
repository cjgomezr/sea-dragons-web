import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuditLogInsertRow } from "@/lib/audit/audit-log";
import type { Role } from "@/lib/auth/roles";
import {
  EVALUATION_CATEGORIES_API_PATH,
  EVALUATION_CATEGORIES_ORDER_API_PATH,
} from "@/lib/auth/routes";
import type { SessionState } from "@/lib/auth/session-boundary";
import type {
  CategoryInsertResult,
  EvaluationCategoriesGateways,
  EvaluationCategory,
} from "@/lib/evaluations/evaluation-categories";

/**
 * Los endpoints del catálogo de categorías (#320, RF-3 del PRD de E9). La
 * petición entra por el proxy y sólo llega al handler si la frontera la deja
 * seguir, como en producción: el 401 y el 403 son los de verdad. El dominio
 * va entero; sólo la base es un doble.
 */

const ORIGIN = "http://localhost:3417";
const CONTINUE_HEADER = "x-middleware-next";
const CALLER_ID = "c0c0c0c0-0000-4000-8000-00000000000c";
const CLUB_ID = "5c1ab000-0000-4000-8000-000000000001";
const OTHER_CLUBS_CATEGORY_ID = "ca7e0000-0000-4000-8000-000000000099";
const NEW_CATEGORY_ID = "ca7e0000-0000-4000-8000-000000000011";

const FITNESS: EvaluationCategory = {
  id: "ca7e0000-0000-4000-8000-000000000001",
  name: "Fitness",
  isActive: true,
};
const TEAMWORK: EvaluationCategory = {
  id: "ca7e0000-0000-4000-8000-000000000010",
  name: "Teamwork",
  isActive: false,
};
const CATALOG = [FITNESS, TEAMWORK];

const readSessionState = vi.fn();
const writes: string[] = [];
let callerRole: Role;
let insertResult: CategoryInsertResult;

function isOwnCategory(categoryId: string): boolean {
  return CATALOG.some((category) => category.id === categoryId);
}

function categoriesGateways(): EvaluationCategoriesGateways {
  return {
    members: {
      findRoleRequestMember: async () => ({
        clubId: CLUB_ID,
        fullName: "Carla Coach",
        role: callerRole,
      }),
    },
    categories: {
      findCategories: async () => CATALOG,
      insertCategory: async (_clubId, name) => {
        writes.push(`insert ${name}`);
        return insertResult;
      },
      renameCategory: async ({ categoryId }, name) => {
        if (!isOwnCategory(categoryId)) {
          return { kind: "not_found" };
        }
        writes.push(`rename ${name}`);
        return { kind: "renamed" };
      },
      reorderCategories: async (_clubId, categoryIds) => {
        if (categoryIds.length !== 1) {
          return { kind: "categories_changed" };
        }
        writes.push(`reorder ${categoryIds.join(",")}`);
        return { kind: "reordered" };
      },
      setCategoryActive: async ({ categoryId }, isActive) => {
        if (!isOwnCategory(categoryId)) {
          return { kind: "not_found" };
        }
        writes.push(`active ${isActive}`);
        return { kind: "changed" };
      },
    },
    audit: {
      insertAuditLogRow: async (row: AuditLogInsertRow) => {
        writes.push(`audit ${row.action} ${row.entity_id}`);
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
  readAuthenticatedUserId: async () => CALLER_ID,
}));

vi.mock("@/lib/evaluations/supabase-evaluation-categories-gateways", () => ({
  createSupabaseEvaluationCategoriesGateways: () => ({
    kind: "ready",
    gateways: categoriesGateways(),
  }),
}));

const { proxy } = await import("@/proxy");
const collection = await import("@/app/api/v1/evaluations/categories/route");
const order = await import("@/app/api/v1/evaluations/categories/order/route");
const single = await import("@/app/api/v1/evaluations/categories/[id]/route");

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

function getCategories(): Promise<Response> {
  return throughBoundary(
    new NextRequest(new URL(EVALUATION_CATEGORIES_API_PATH, ORIGIN)),
    collection.GET,
  );
}

function postCategory(body: unknown): Promise<Response> {
  return throughBoundary(
    jsonRequest(EVALUATION_CATEGORIES_API_PATH, "POST", body),
    collection.POST,
  );
}

function putOrder(body: unknown): Promise<Response> {
  return throughBoundary(
    jsonRequest(EVALUATION_CATEGORIES_ORDER_API_PATH, "PUT", body),
    order.PUT,
  );
}

function patchCategory(categoryId: string, body: unknown): Promise<Response> {
  return throughBoundary(
    jsonRequest(
      `${EVALUATION_CATEGORIES_API_PATH}/${categoryId}`,
      "PATCH",
      body,
    ),
    (request) =>
      single.PATCH(request, { params: Promise.resolve({ id: categoryId }) }),
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

beforeEach(() => {
  vi.clearAllMocks();
  writes.length = 0;
  insertResult = { kind: "created", categoryId: NEW_CATEGORY_ID };
  givenSession({ kind: "active", role: "Coach" });
});

describe("endpoints de categorías", () => {
  describe("quién puede", () => {
    it.each<Role>(["Player", "Committee"])(
      "responde 403 a un %s en cada endpoint, sin tocar nada",
      async (role) => {
        givenSession({ kind: "active", role });

        const responses = [
          await getCategories(),
          await postCategory({ name: "Breath hold" }),
          await putOrder({ categoryIds: [FITNESS.id] }),
          await patchCategory(FITNESS.id, { isActive: false }),
        ];

        expect(responses.map((response) => response.status)).toEqual([
          403, 403, 403, 403,
        ]);
        expect(writes).toEqual([]);
      },
    );

    it("el handler también responde 403 a un Player que se salte la frontera", async () => {
      givenSession({ kind: "active", role: "Player" });

      const response = await collection.POST(
        jsonRequest(EVALUATION_CATEGORIES_API_PATH, "POST", {
          name: "Breath hold",
        }),
      );

      expect(response.status).toBe(403);
      expect(writes).toEqual([]);
    });

    it("responde 401 sin sesión", async () => {
      givenSession({ kind: "anonymous" });

      const response = await getCategories();

      expect(response.status).toBe(401);
    });

    it.each<Role>(["Coach", "Admin"])("responde 200 a un %s", async (role) => {
      givenSession({ kind: "active", role });

      const response = await getCategories();

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        data: { categories: CATALOG },
      });
    });
  });

  describe("POST: añadir", () => {
    it("responde 201 con el catálogo y lo anota", async () => {
      const response = await postCategory({ name: " Breath hold " });

      expect(response.status).toBe(201);
      await expect(response.json()).resolves.toEqual({
        data: { categories: CATALOG },
      });
      expect(writes).toEqual([
        "insert Breath hold",
        `audit evaluation_category.created ${NEW_CATEGORY_ID}`,
      ]);
    });

    it("responde 400 a un nombre repetido, sin anotar nada", async () => {
      insertResult = { kind: "name_taken" };

      const response = await postCategory({ name: "Fitness" });

      expect(response.status).toBe(400);
      await expect(errorOf(response)).resolves.toMatchObject({
        reason: "name_taken",
      });
      expect(writes).toEqual(["insert Fitness"]);
    });

    it.each([
      ["vacío", "   ", "name_required"],
      ["de 41 caracteres", "a".repeat(41), "name_too_long"],
    ])(
      "responde 400 a un nombre %s sin llegar a la base",
      async (_case, name, reason) => {
        const response = await postCategory({ name });

        expect(response.status).toBe(400);
        await expect(errorOf(response)).resolves.toMatchObject({ reason });
        expect(writes).toEqual([]);
      },
    );

    it("responde 400 a un cuerpo sin nombre", async () => {
      const response = await postCategory({});

      expect(response.status).toBe(400);
      expect(writes).toEqual([]);
    });
  });

  describe("PATCH: renombrar, desactivar y reactivar", () => {
    it("renombra y lo anota", async () => {
      const response = await patchCategory(FITNESS.id, { name: "Stamina" });

      expect(response.status).toBe(200);
      expect(writes).toEqual([
        "rename Stamina",
        `audit evaluation_category.renamed ${FITNESS.id}`,
      ]);
    });

    it("desactiva y lo anota", async () => {
      const response = await patchCategory(FITNESS.id, { isActive: false });

      expect(response.status).toBe(200);
      expect(writes).toEqual([
        "active false",
        `audit evaluation_category.deactivated ${FITNESS.id}`,
      ]);
    });

    it("reactiva y lo anota", async () => {
      const response = await patchCategory(TEAMWORK.id, { isActive: true });

      expect(response.status).toBe(200);
      expect(writes).toEqual([
        "active true",
        `audit evaluation_category.reactivated ${TEAMWORK.id}`,
      ]);
    });

    it("responde 400 si trae nombre y estado a la vez", async () => {
      const response = await patchCategory(FITNESS.id, {
        name: "Stamina",
        isActive: false,
      });

      expect(response.status).toBe(400);
      expect(writes).toEqual([]);
    });

    it("responde 404 a una categoría de otro club", async () => {
      const response = await patchCategory(OTHER_CLUBS_CATEGORY_ID, {
        isActive: false,
      });

      expect(response.status).toBe(404);
    });

    it("responde 404 a un id que no es un uuid", async () => {
      const response = await patchCategory("no-es-un-uuid", {
        isActive: false,
      });

      expect(response.status).toBe(404);
      expect(writes).toEqual([]);
    });
  });

  describe("PUT order: reordenar", () => {
    it("aplica el orden y lo anota sobre el club", async () => {
      const response = await putOrder({ categoryIds: [FITNESS.id] });

      expect(response.status).toBe(200);
      expect(writes).toEqual([
        `reorder ${FITNESS.id}`,
        `audit evaluation_category.reordered ${CLUB_ID}`,
      ]);
    });

    it("responde 409 si las activas cambiaron entretanto", async () => {
      const response = await putOrder({
        categoryIds: [FITNESS.id, TEAMWORK.id],
      });

      expect(response.status).toBe(409);
      await expect(errorOf(response)).resolves.toMatchObject({
        reason: "evaluation_categories_changed",
      });
    });

    it("responde 400 a un orden vacío, sin anotar nada", async () => {
      const response = await putOrder({ categoryIds: [] });

      expect(response.status).toBe(400);
      expect(writes).toEqual([]);
    });

    it("responde 400 a un id que no es un uuid", async () => {
      const response = await putOrder({ categoryIds: ["no-es-un-uuid"] });

      expect(response.status).toBe(400);
      expect(writes).toEqual([]);
    });
  });
});
