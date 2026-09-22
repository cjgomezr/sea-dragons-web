import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NOTIFICATIONS_API_PATH } from "@/lib/auth/routes";
import type { SessionState } from "@/lib/auth/session-boundary";
import type {
  MarkReadOutcome,
  MemberNotification,
} from "@/lib/notifications/member-notifications";

/**
 * Los avisos por la API (#265, RF-3 a RF-5 del PRD de E6): listar, contar los
 * no leídos y marcarlos. Cualquier cuenta activa los alcanza, y siempre sobre
 * sus propios avisos. Las peticiones entran por el proxy y sólo llegan al
 * handler si la frontera las deja seguir, como en producción.
 */

const ORIGIN = "http://localhost:3417";
/** Lo que hace Next con la respuesta del proxy: si es `NextResponse.next()`
 * la petición sigue hasta la ruta; si no, esa respuesta es la definitiva. */
const CONTINUE_HEADER = "x-middleware-next";

const USER_ID = "9a8b7c6d-5e4f-4a3b-9c8d-7e6f5a4b3c2d";
const NOTIFICATION_ID = "4e000000-0000-4000-8000-000000000001";
const SESSION_CLIENT = { soy: "el cliente de la sesión" };

const NEWEST: MemberNotification = {
  id: NOTIFICATION_ID,
  type: "role_changed",
  data: { newRole: "Coach" },
  createdAt: "2026-09-22T10:00:00.000Z",
  isRead: false,
};
const OLDEST: MemberNotification = {
  id: "4e000000-0000-4000-8000-000000000002",
  type: "role_request_rejected",
  data: { requestedRole: "Committee" },
  createdAt: "2026-09-20T10:00:00.000Z",
  isRead: true,
};

const readSessionState = vi.fn();
const readAuthenticatedUserId = vi.fn();
const createReaderWith = vi.fn();
const listRecent = vi.fn();
const countUnread = vi.fn();
const markRead = vi.fn();
const markAllRead = vi.fn();
let isMarkerConfigured = true;

vi.mock("@/lib/supabase/session-client", () => ({
  readIncomingCookies: () => [],
  applySessionCookies: () => undefined,
  createSessionClient: () => ({
    kind: "ready",
    client: SESSION_CLIENT,
    recorder: { recorded: () => ({ cookies: [], headers: {} }) },
  }),
}));

vi.mock("@/lib/auth/session-reader", () => ({
  readSessionState: (...args: unknown[]) => readSessionState(...args),
  readAuthenticatedUserId: (...args: unknown[]) =>
    readAuthenticatedUserId(...args),
}));

vi.mock("@/lib/notifications/supabase-notification-gateways", () => ({
  createSupabaseNotificationReader: (client: unknown) => {
    createReaderWith(client);
    return { listRecent, countUnread };
  },
  createSupabaseNotificationMarker: () =>
    isMarkerConfigured
      ? { kind: "ready", marker: { markRead, markAllRead } }
      : { kind: "unconfigured", missingKeys: ["SUPABASE_SERVICE_ROLE_KEY"] },
}));

const { proxy } = await import("@/proxy");
const listRoute = await import("@/app/api/v1/notifications/route");
const unreadCountRoute =
  await import("@/app/api/v1/notifications/unread-count/route");
const readAllRoute = await import("@/app/api/v1/notifications/read-all/route");
const readOneRoute = await import("@/app/api/v1/notifications/[id]/read/route");

type Endpoint = {
  readonly name: string;
  readonly method: "GET" | "POST";
  readonly path: string;
  readonly call: (request: NextRequest) => Promise<Response>;
  /** Un método que el endpoint no implementa, para comprobar el 405. */
  readonly callWrongMethod: (request: NextRequest) => Promise<Response>;
};

function readOnePath(id: string): string {
  return `${NOTIFICATIONS_API_PATH}/${id}/read`;
}

function callReadOne(id: string): (request: NextRequest) => Promise<Response> {
  return (request) =>
    readOneRoute.POST(request, { params: Promise.resolve({ id }) });
}

const LIST: Endpoint = {
  name: "GET /notifications",
  method: "GET",
  path: NOTIFICATIONS_API_PATH,
  call: (request) => listRoute.GET(request),
  callWrongMethod: (request) => listRoute.DELETE(request),
};
const UNREAD_COUNT: Endpoint = {
  name: "GET /notifications/unread-count",
  method: "GET",
  path: `${NOTIFICATIONS_API_PATH}/unread-count`,
  call: (request) => unreadCountRoute.GET(request),
  callWrongMethod: (request) => unreadCountRoute.DELETE(request),
};
const READ_ALL: Endpoint = {
  name: "POST /notifications/read-all",
  method: "POST",
  path: `${NOTIFICATIONS_API_PATH}/read-all`,
  call: (request) => readAllRoute.POST(request),
  callWrongMethod: (request) => readAllRoute.GET(request),
};
const READ_ONE: Endpoint = {
  name: "POST /notifications/{id}/read",
  method: "POST",
  path: readOnePath(NOTIFICATION_ID),
  call: callReadOne(NOTIFICATION_ID),
  callWrongMethod: (request) => readOneRoute.GET(request),
};

const ENDPOINTS: readonly Endpoint[] = [LIST, UNREAD_COUNT, READ_ALL, READ_ONE];

function givenSession(session: SessionState): void {
  readSessionState.mockResolvedValue(session);
}

async function requestThroughBoundary(endpoint: Endpoint): Promise<Response> {
  const request = new NextRequest(new URL(endpoint.path, ORIGIN), {
    method: endpoint.method,
  });
  const boundaryResponse = await proxy(request);
  return boundaryResponse.headers.get(CONTINUE_HEADER) === "1"
    ? endpoint.call(request)
    : boundaryResponse;
}

function givenMarkReadOutcome(outcome: MarkReadOutcome): void {
  markRead.mockResolvedValue(outcome);
}

beforeEach(() => {
  vi.clearAllMocks();
  isMarkerConfigured = true;
  givenSession({ kind: "active", role: "Player" });
  readAuthenticatedUserId.mockResolvedValue(USER_ID);
  listRecent.mockResolvedValue([NEWEST, OLDEST]);
  countUnread.mockResolvedValue(3);
  givenMarkReadOutcome("marked");
  markAllRead.mockResolvedValue(undefined);
});

describe("endpoints de avisos", () => {
  describe("GET /api/v1/notifications", () => {
    it.each(["Admin", "Coach", "Committee", "Player"] as const)(
      "responde 200 a un %s con sus avisos tal como los da la base",
      async (role) => {
        givenSession({ kind: "active", role });

        const response = await requestThroughBoundary(LIST);

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toEqual({
          data: { notifications: [NEWEST, OLDEST] },
        });
      },
    );

    it("pide los 50 más recientes de quien llama, con su sesión", async () => {
      await requestThroughBoundary(LIST);

      expect(createReaderWith).toHaveBeenCalledWith(SESSION_CLIENT);
      expect(listRecent).toHaveBeenCalledWith(USER_ID, 50);
    });

    it("responde una lista vacía a quien no tiene avisos", async () => {
      listRecent.mockResolvedValue([]);

      const response = await requestThroughBoundary(LIST);

      await expect(response.json()).resolves.toEqual({
        data: { notifications: [] },
      });
    });

    it("responde 500 sin filtrar el mensaje cuando la base falla", async () => {
      listRecent.mockRejectedValue(new Error("notifications is on fire"));
      vi.spyOn(console, "error").mockImplementation(() => undefined);

      const response = await requestThroughBoundary(LIST);

      expect(response.status).toBe(500);
      expect(JSON.stringify(await response.json())).not.toContain("on fire");
    });
  });

  describe("GET /api/v1/notifications/unread-count", () => {
    it("responde cuántos avisos sin leer tiene quien llama", async () => {
      const response = await requestThroughBoundary(UNREAD_COUNT);

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        data: { unreadCount: 3 },
      });
      expect(createReaderWith).toHaveBeenCalledWith(SESSION_CLIENT);
      expect(countUnread).toHaveBeenCalledWith(USER_ID);
    });
  });

  describe("POST /api/v1/notifications/read-all", () => {
    it("marca todos los avisos de quien llama y responde 204 sin cuerpo", async () => {
      const response = await requestThroughBoundary(READ_ALL);

      expect(response.status).toBe(204);
      await expect(response.text()).resolves.toBe("");
      expect(markAllRead).toHaveBeenCalledWith(USER_ID);
    });

    it("responde 503 sin tocar nada si falta la llave de servicio", async () => {
      isMarkerConfigured = false;

      const response = await requestThroughBoundary(READ_ALL);

      expect(response.status).toBe(503);
      expect(markAllRead).not.toHaveBeenCalled();
    });
  });

  describe("POST /api/v1/notifications/{id}/read", () => {
    it("marca ese aviso de quien llama y responde 204", async () => {
      const response = await requestThroughBoundary(READ_ONE);

      expect(response.status).toBe(204);
      expect(markRead).toHaveBeenCalledWith({
        userId: USER_ID,
        notificationId: NOTIFICATION_ID,
      });
    });

    it("responde 204 a un aviso que ya estaba leído", async () => {
      givenMarkReadOutcome("already_read");

      const response = await requestThroughBoundary(READ_ONE);

      expect(response.status).toBe(204);
    });

    it("responde 404 al aviso de otro miembro o a uno que no existe", async () => {
      givenMarkReadOutcome("not_found");

      const response = await requestThroughBoundary(READ_ONE);

      expect(response.status).toBe(404);
      await expect(response.json()).resolves.toMatchObject({
        error: { code: "not_found" },
      });
    });

    it("responde 404 sin preguntar a la base cuando el id no es un uuid", async () => {
      const response = await requestThroughBoundary({
        ...READ_ONE,
        path: readOnePath("no-es-un-uuid"),
        call: callReadOne("no-es-un-uuid"),
      });

      expect(response.status).toBe(404);
      expect(markRead).not.toHaveBeenCalled();
    });

    it("responde 503 sin tocar nada si falta la llave de servicio", async () => {
      isMarkerConfigured = false;

      const response = await requestThroughBoundary(READ_ONE);

      expect(response.status).toBe(503);
      expect(markRead).not.toHaveBeenCalled();
    });
  });

  describe("fronteras", () => {
    it.each(ENDPOINTS)(
      "$name responde 401 sin sesión y no toca los avisos",
      async (endpoint) => {
        givenSession({ kind: "anonymous" });

        const response = await requestThroughBoundary(endpoint);

        expect(response.status).toBe(401);
        expectNoNotificationTouched();
      },
    );

    it.each(ENDPOINTS)(
      "$name responde 403 a una cuenta incompleta y no toca los avisos",
      async (endpoint) => {
        givenSession({ kind: "incomplete" });

        const response = await requestThroughBoundary(endpoint);

        expect(response.status).toBe(403);
        expectNoNotificationTouched();
      },
    );

    it.each(ENDPOINTS)(
      "$name responde 401 si la sesión caduca entre la frontera y el handler",
      async (endpoint) => {
        readAuthenticatedUserId.mockResolvedValue(null);

        const response = await requestThroughBoundary(endpoint);

        expect(response.status).toBe(401);
        expectNoNotificationTouched();
      },
    );

    it.each(ENDPOINTS)(
      "$name responde 405 a un método que no implementa",
      async (endpoint) => {
        const response = await endpoint.callWrongMethod(
          new NextRequest(new URL(endpoint.path, ORIGIN)),
        );

        expect(response.status).toBe(405);
      },
    );
  });
});

function expectNoNotificationTouched(): void {
  expect(listRecent).not.toHaveBeenCalled();
  expect(countUnread).not.toHaveBeenCalled();
  expect(markRead).not.toHaveBeenCalled();
  expect(markAllRead).not.toHaveBeenCalled();
}
