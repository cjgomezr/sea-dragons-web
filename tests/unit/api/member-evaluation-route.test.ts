import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AccountStatus } from "@/lib/auth/account-status";
import type { Role } from "@/lib/auth/roles";
import { EVALUATIONS_API_PATH } from "@/lib/auth/routes";
import type { SessionState } from "@/lib/auth/session-boundary";
import type {
  EvaluationCreation,
  EvaluationRefresh,
  MemberEvaluationGateways,
  RatingsSave,
  StoredEvaluation,
} from "@/lib/evaluations/member-evaluation";

/**
 * Los endpoints de la evaluación de un miembro (#319, RF-1, RF-2 y RF-5 del
 * PRD de E9). La petición entra por el proxy y sólo llega al handler si la
 * frontera la deja seguir, como en producción: el 401 y el 403 son los de
 * verdad. Es el test que respalda FR-055 en la capa del endpoint. El dominio
 * va entero; sólo la base es un doble.
 */

const ORIGIN = "http://localhost:3417";
const CONTINUE_HEADER = "x-middleware-next";
const CALLER_ID = "c0c0c0c0-0000-4000-8000-00000000000c";
const CLUB_ID = "5c1ab000-0000-4000-8000-000000000001";
const MEMBER_ID = "4e4e4e4e-0000-4000-8000-000000000001";
const FITNESS_ID = "ca7e0000-0000-4000-8000-000000000001";
const SPEED_ID = "ca7e0000-0000-4000-8000-000000000002";
const READ_AT = "2026-09-27T01:02:03.123456+00:00";

const STORED: StoredEvaluation = {
  updatedAt: READ_AT,
  missingCategoryCount: 0,
  ratings: [
    { categoryId: FITNESS_ID, name: "Fitness", rating: 8, isRetired: false },
    { categoryId: SPEED_ID, name: "Speed", rating: 9, isRetired: false },
  ],
};

const readSessionState = vi.fn();
const writes: string[] = [];
let callerRole: Role;
let memberStatus: AccountStatus | null;
let stored: StoredEvaluation | null;
let creation: EvaluationCreation;
let save: RatingsSave;
let refresh: EvaluationRefresh;

function memberEvaluationGateways(): MemberEvaluationGateways {
  return {
    members: {
      findRoleRequestMember: async () => ({
        clubId: CLUB_ID,
        fullName: "Carla Coach",
        role: callerRole,
      }),
    },
    evaluations: {
      findMemberStatus: async () => memberStatus,
      findEvaluation: async () => stored,
      createEvaluation: async () => {
        writes.push("create");
        if (creation.kind === "created") {
          stored = STORED;
        }
        return creation;
      },
      saveRatings: async (_scope, submission) => {
        writes.push(
          `save ${submission.expectedUpdatedAt} ${submission.ratings
            .map((change) => `${change.categoryId}=${change.rating}`)
            .join(",")}`,
        );
        return save;
      },
      refreshEvaluation: async () => {
        writes.push("refresh");
        return refresh;
      },
    },
    audit: {
      insertAuditLogRow: async (row) => {
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

vi.mock("@/lib/evaluations/supabase-member-evaluation-gateways", () => ({
  createSupabaseMemberEvaluationGateways: () => ({
    kind: "ready",
    gateways: memberEvaluationGateways(),
  }),
}));

const { proxy } = await import("@/proxy");
const route = await import("@/app/api/v1/evaluations/[id]/route");
const refreshRoute =
  await import("@/app/api/v1/evaluations/[id]/refresh/route");

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

function evaluationUrl(memberId: string): URL {
  return new URL(`${EVALUATIONS_API_PATH}/${memberId}`, ORIGIN);
}

function paramsOf(memberId: string) {
  return { params: Promise.resolve({ id: memberId }) };
}

function getEvaluation(memberId = MEMBER_ID): Promise<Response> {
  return throughBoundary(new NextRequest(evaluationUrl(memberId)), (request) =>
    route.GET(request, paramsOf(memberId)),
  );
}

function postEvaluation(memberId = MEMBER_ID): Promise<Response> {
  return throughBoundary(
    new NextRequest(evaluationUrl(memberId), { method: "POST" }),
    (request) => route.POST(request, paramsOf(memberId)),
  );
}

function postRefresh(memberId = MEMBER_ID): Promise<Response> {
  return throughBoundary(
    new NextRequest(new URL(`${evaluationUrl(memberId)}/refresh`), {
      method: "POST",
    }),
    (request) => refreshRoute.POST(request, paramsOf(memberId)),
  );
}

function putRequest(body: unknown, memberId = MEMBER_ID): NextRequest {
  return new NextRequest(evaluationUrl(memberId), {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function putRatings(body: unknown, memberId = MEMBER_ID): Promise<Response> {
  return throughBoundary(putRequest(body, memberId), (request) =>
    route.PUT(request, paramsOf(memberId)),
  );
}

function ratingsBody(rating: unknown, categoryId = FITNESS_ID): unknown {
  return { expectedUpdatedAt: READ_AT, ratings: [{ categoryId, rating }] };
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
  memberStatus = "active";
  stored = STORED;
  creation = { kind: "created" };
  save = { kind: "saved" };
  refresh = { kind: "already_current" };
  givenSession({ kind: "active", role: "Coach" });
});

describe("endpoints de evaluaciones", () => {
  describe("quién llega", () => {
    it.each([
      ["GET", getEvaluation],
      ["POST", postEvaluation],
      ["PUT", () => putRatings(ratingsBody(9))],
      ["POST refresh", () => postRefresh()],
    ] as const)("responde 401 al %s sin sesión", async (_method, call) => {
      givenSession({ kind: "anonymous" });

      const response = await call();

      expect(response.status).toBe(401);
    });

    it.each<[Role, string]>([
      ["Player", "otro miembro"],
      ["Player", "su propia evaluación"],
      ["Committee", "otro miembro"],
      ["Committee", "su propia evaluación"],
    ])("responde 403 a un %s que pide %s", async (role, target) => {
      givenSession({ kind: "active", role });
      const memberId = target === "otro miembro" ? MEMBER_ID : CALLER_ID;

      const responses = [
        await getEvaluation(memberId),
        await postEvaluation(memberId),
        await putRatings(ratingsBody(9), memberId),
        await postRefresh(memberId),
      ];

      expect(responses.map((response) => response.status)).toEqual([
        403, 403, 403, 403,
      ]);
      expect(writes).toEqual([]);
    });

    it("el handler también responde 403 a un Player que se salte la frontera", async () => {
      givenSession({ kind: "active", role: "Player" });

      const response = await route.GET(
        new NextRequest(evaluationUrl(CALLER_ID)),
        paramsOf(CALLER_ID),
      );

      expect(response.status).toBe(403);
    });

    it.each<Role>(["Coach", "Admin"])("responde 200 a un %s", async (role) => {
      givenSession({ kind: "active", role });

      const response = await getEvaluation();

      expect(response.status).toBe(200);
    });
  });

  describe("GET: leer", () => {
    it("devuelve las categorías con su valoración y el OVR", async () => {
      const response = await getEvaluation();

      await expect(response.json()).resolves.toEqual({
        data: {
          status: "evaluated",
          memberId: MEMBER_ID,
          updatedAt: READ_AT,
          overallRating: 8.5,
          ratings: STORED.ratings,
          isCurrent: true,
        },
      });
    });

    it("dice explícitamente que el miembro no tiene evaluación", async () => {
      stored = null;

      const response = await getEvaluation();

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        data: { status: "not_evaluated", memberId: MEMBER_ID },
      });
    });

    it("distingue un OVR nulo de un cero", async () => {
      stored = { updatedAt: READ_AT, missingCategoryCount: 0, ratings: [] };

      const response = await getEvaluation();

      const body = (await response.json()) as {
        data: { overallRating: unknown };
      };
      expect(body.data.overallRating).toBeNull();
    });

    it("responde 404 a un id que no es de ningún miembro", async () => {
      const response = await getEvaluation("no-es-un-uuid");

      expect(response.status).toBe(404);
    });

    it("responde 404 a quien no es miembro del club", async () => {
      memberStatus = null;

      const response = await getEvaluation();

      expect(response.status).toBe(404);
      await expect(errorOf(response)).resolves.toMatchObject({
        reason: "member_not_found",
      });
    });
  });

  describe("POST: crear", () => {
    it("responde 201 con la evaluación nueva y la anota", async () => {
      stored = null;

      const response = await postEvaluation();

      expect(response.status).toBe(201);
      await expect(response.json()).resolves.toMatchObject({
        data: { status: "evaluated", overallRating: 8.5 },
      });
      expect(writes).toEqual([
        "create",
        `audit member_evaluation.created ${MEMBER_ID}`,
      ]);
    });

    it("responde 422 con un miembro dado de baja", async () => {
      memberStatus = "inactive";

      const response = await postEvaluation();

      expect(response.status).toBe(422);
      await expect(errorOf(response)).resolves.toMatchObject({
        reason: "member_inactive",
      });
      expect(writes).toEqual([]);
    });

    it("responde 422 si el club no tiene categorías activas", async () => {
      creation = { kind: "no_active_categories" };

      const response = await postEvaluation();

      expect(response.status).toBe(422);
      await expect(errorOf(response)).resolves.toMatchObject({
        reason: "no_active_categories",
      });
    });

    it("responde 409 si el miembro ya tiene evaluación", async () => {
      creation = { kind: "already_exists" };

      const response = await postEvaluation();

      expect(response.status).toBe(409);
      await expect(errorOf(response)).resolves.toMatchObject({
        reason: "evaluation_exists",
      });
    });
  });

  describe("PUT: guardar valoraciones", () => {
    it("responde 200 con la evaluación recalculada y anota sin las notas", async () => {
      const response = await putRatings(ratingsBody(9));

      expect(response.status).toBe(200);
      expect(writes).toEqual([
        `save ${READ_AT} ${FITNESS_ID}=9`,
        `audit member_evaluation.ratings_saved ${MEMBER_ID}`,
      ]);
    });

    it.each([
      ["fuera de rango por abajo", 0],
      ["fuera de rango por arriba", 11],
      ["con decimales", 5.5],
      ["que no es un número", "7"],
    ])(
      "responde 400 a una valoración %s sin escribir",
      async (_case, rating) => {
        const response = await putRatings(ratingsBody(rating));

        expect(response.status).toBe(400);
        expect(writes).toEqual([]);
      },
    );

    it("responde 400 a una categoría que no es de la evaluación", async () => {
      save = { kind: "unknown_category", categoryId: SPEED_ID };

      const response = await putRatings(ratingsBody(9, SPEED_ID));

      expect(response.status).toBe(400);
      await expect(errorOf(response)).resolves.toMatchObject({
        reason: "unknown_category",
      });
      expect(writes.some((write) => write.startsWith("audit"))).toBe(false);
    });

    it("responde 400 sin la fecha que se leyó", async () => {
      const response = await putRatings({
        ratings: [{ categoryId: FITNESS_ID, rating: 9 }],
      });

      expect(response.status).toBe(400);
      expect(writes).toEqual([]);
    });

    it("responde 409 si la evaluación cambió desde que se leyó", async () => {
      save = { kind: "evaluation_changed" };

      const response = await putRatings(ratingsBody(9));

      expect(response.status).toBe(409);
      await expect(errorOf(response)).resolves.toMatchObject({
        reason: "evaluation_changed",
      });
    });

    it("responde 422 con un miembro dado de baja", async () => {
      memberStatus = "inactive";

      const response = await putRatings(ratingsBody(9));

      expect(response.status).toBe(422);
      expect(writes).toEqual([]);
    });

    it("responde 404 si el miembro no tiene evaluación", async () => {
      save = { kind: "evaluation_not_found" };

      const response = await putRatings(ratingsBody(9));

      expect(response.status).toBe(404);
      await expect(errorOf(response)).resolves.toMatchObject({
        reason: "evaluation_not_found",
      });
    });
  });

  describe("POST refresh: poner al día", () => {
    it("responde 200 con qué pasó y la evaluación, y lo anota", async () => {
      refresh = { kind: "refreshed", addedCount: 1, removedCount: 2 };

      const response = await postRefresh();

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        data: {
          outcome: { kind: "refreshed", addedCount: 1, removedCount: 2 },
          evaluation: expect.objectContaining({ status: "evaluated" }),
        },
      });
      expect(writes).toEqual([
        "refresh",
        `audit member_evaluation.refreshed ${MEMBER_ID}`,
      ]);
    });

    it("responde 200 diciendo que ya estaba al día, sin anotar nada", async () => {
      const response = await postRefresh();

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        data: { outcome: { kind: "already_current" } },
      });
      expect(writes).toEqual(["refresh"]);
    });

    it("responde 422 si el club no tiene categorías activas", async () => {
      refresh = { kind: "no_active_categories" };

      const response = await postRefresh();

      expect(response.status).toBe(422);
      await expect(errorOf(response)).resolves.toMatchObject({
        reason: "no_active_categories",
      });
    });

    it("responde 404 si el miembro no tiene evaluación", async () => {
      refresh = { kind: "evaluation_not_found" };

      const response = await postRefresh();

      expect(response.status).toBe(404);
      await expect(errorOf(response)).resolves.toMatchObject({
        reason: "evaluation_not_found",
      });
    });

    it("responde 404 a un id que no es de ningún miembro", async () => {
      const response = await postRefresh("no-es-un-uuid");

      expect(response.status).toBe(404);
      expect(writes).toEqual([]);
    });
  });
});
