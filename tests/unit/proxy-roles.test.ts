import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createApiRoute } from "@/lib/api/handler";
import type { Capability } from "@/lib/auth/roles";
import {
  COMPLETE_REGISTRATION_PATH,
  DASHBOARD_PATH,
  EVALUATIONS_PATH,
  SIGN_IN_PATH,
} from "@/lib/auth/routes";
import type { SessionState } from "@/lib/auth/session-boundary";

/**
 * La frontera por rol vista desde fuera: una petición entra por el proxy y,
 * sólo si el proxy la deja seguir, llega al handler. Hoy no existe ningún
 * endpoint restringido, así que el test declara uno en el mismo mapa que
 * usarán los de verdad.
 */

// `vi.hoisted` porque el mock de las rutas sube al principio del archivo y
// necesita el endpoint de prueba antes de que se evalúe lo demás.
const { RESTRICTED_TEST_API_PATH, RESTRICTED_TEST_CAPABILITY } = vi.hoisted(
  () => ({
    RESTRICTED_TEST_API_PATH: "/api/v1/prueba-restringida",
    RESTRICTED_TEST_CAPABILITY: "viewEvaluations" as Capability,
  }),
);

const createSessionClient = vi.fn();
const applySessionCookies = vi.fn();
const readSessionState = vi.fn();

vi.mock("@/lib/supabase/session-client", () => ({
  createSessionClient: (...args: unknown[]) => createSessionClient(...args),
  applySessionCookies: (...args: unknown[]) => applySessionCookies(...args),
  readIncomingCookies: () => [],
}));

vi.mock("@/lib/auth/session-reader", () => ({
  readSessionState: (...args: unknown[]) => readSessionState(...args),
}));

vi.mock("@/lib/auth/routes", async (importOriginal) => {
  const routes = await importOriginal<typeof import("@/lib/auth/routes")>();
  return {
    ...routes,
    RESTRICTED_ROUTES: [
      ...routes.RESTRICTED_ROUTES,
      {
        path: RESTRICTED_TEST_API_PATH,
        capability: RESTRICTED_TEST_CAPABILITY,
      },
    ],
  };
});

const { proxy } = await import("@/proxy");

const ORIGIN = "http://localhost:3417";
const TEMPORARY_REDIRECT = 307;

/** Lo que hace Next con la respuesta del proxy: si es `NextResponse.next()`
 * la petición sigue hasta la ruta; si no, esa respuesta es la definitiva. */
const CONTINUE_HEADER = "x-middleware-next";

const handlerWork = vi.fn(async () => ({ data: { secreto: "OVR 87" } }));
const restrictedEndpoint = createApiRoute({ handler: handlerWork });

function requestFor(path: string): NextRequest {
  return new NextRequest(new URL(path, ORIGIN));
}

async function requestThroughBoundary(path: string): Promise<Response> {
  const request = requestFor(path);
  const boundaryResponse = await proxy(request);
  return boundaryResponse.headers.get(CONTINUE_HEADER) === "1"
    ? restrictedEndpoint(request)
    : boundaryResponse;
}

function givenSession(session: SessionState): void {
  createSessionClient.mockReturnValue({
    kind: "ready",
    client: {},
    recorder: { recorded: () => ({ cookies: [], headers: {} }) },
  });
  readSessionState.mockResolvedValue(session);
}

function redirectedTo(response: Response): string | null {
  const location = response.headers.get("location");
  return location === null ? null : new URL(location).pathname;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("frontera por rol en endpoints", () => {
  it("responde 403 con la forma de error, sin ejecutar el handler, al rol sin la capacidad", async () => {
    givenSession({ kind: "active", role: "Player" });

    const response = await requestThroughBoundary(RESTRICTED_TEST_API_PATH);

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: { code: "forbidden", message: expect.any(String) },
    });
    expect(handlerWork).not.toHaveBeenCalled();
  });

  it("ejecuta el handler para el rol que tiene la capacidad", async () => {
    givenSession({ kind: "active", role: "Coach" });

    const response = await requestThroughBoundary(RESTRICTED_TEST_API_PATH);

    expect(response.status).toBe(200);
    expect(handlerWork).toHaveBeenCalledTimes(1);
  });

  it("no ejecuta el handler tampoco en lo que cuelga del endpoint restringido", async () => {
    givenSession({ kind: "active", role: "Committee" });

    const response = await requestThroughBoundary(
      `${RESTRICTED_TEST_API_PATH}/123`,
    );

    expect(response.status).toBe(403);
    expect(handlerWork).not.toHaveBeenCalled();
  });

  it("explica el 403 por el rol, no por una cuenta incompleta", async () => {
    givenSession({ kind: "incomplete" });
    const incompleteMessage = await (
      await requestThroughBoundary(RESTRICTED_TEST_API_PATH)
    ).json();
    givenSession({ kind: "active", role: "Player" });

    const roleMessage = await (
      await requestThroughBoundary(RESTRICTED_TEST_API_PATH)
    ).json();

    expect(roleMessage.error.message).not.toBe(incompleteMessage.error.message);
  });
});

describe("orden de las fronteras", () => {
  it("responde 401 a un endpoint restringido pedido sin sesión", async () => {
    givenSession({ kind: "anonymous" });

    const response = await requestThroughBoundary(RESTRICTED_TEST_API_PATH);

    expect(response.status).toBe(401);
    expect(handlerWork).not.toHaveBeenCalled();
  });

  it("responde 403 de cuenta incompleta a un endpoint restringido", async () => {
    givenSession({ kind: "incomplete" });

    const response = await requestThroughBoundary(RESTRICTED_TEST_API_PATH);

    expect(response.status).toBe(403);
    expect(handlerWork).not.toHaveBeenCalled();
  });

  it("manda a la entrada una pantalla restringida pedida sin sesión", async () => {
    givenSession({ kind: "anonymous" });

    const response = await proxy(requestFor(EVALUATIONS_PATH));

    expect(redirectedTo(response)).toBe(SIGN_IN_PATH);
  });

  it("manda a completar registro una pantalla restringida pedida con la cuenta incompleta", async () => {
    givenSession({ kind: "incomplete" });

    const response = await proxy(requestFor(EVALUATIONS_PATH));

    expect(redirectedTo(response)).toBe(COMPLETE_REGISTRATION_PATH);
  });
});

describe("frontera por rol en pantallas, a través del proxy", () => {
  it("redirige al panel a un Player que pide evaluaciones", async () => {
    givenSession({ kind: "active", role: "Player" });

    const response = await proxy(requestFor(EVALUATIONS_PATH));

    expect(response.status).toBe(TEMPORARY_REDIRECT);
    expect(redirectedTo(response)).toBe(DASHBOARD_PATH);
  });

  it("lee la sesión una sola vez por petición", async () => {
    givenSession({ kind: "active", role: "Coach" });

    await proxy(requestFor(EVALUATIONS_PATH));

    expect(readSessionState).toHaveBeenCalledTimes(1);
  });
});
