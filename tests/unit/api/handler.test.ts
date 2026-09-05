import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  createApiModule,
  createApiRoute,
  createNotFoundModule,
} from "@/lib/api/handler";
import { ApiError } from "@/lib/api/response";

function postRequest(url: string, body: string): NextRequest {
  return new NextRequest(url, {
    method: "POST",
    body,
    headers: { "content-type": "application/json" },
  });
}

describe("respuesta correcta", () => {
  it("envuelve el valor del handler en data con 200 por defecto", async () => {
    const route = createApiRoute({
      handler: async () => ({ data: { greeting: "hola" } }),
    });

    const response = await route(
      new NextRequest("http://localhost/api/v1/greet"),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: { greeting: "hola" },
    });
  });

  it("usa 201 cuando el handler declara creación", async () => {
    const route = createApiRoute({
      handler: async () => ({ data: { id: "1" }, status: 201 as const }),
    });

    const response = await route(
      new NextRequest("http://localhost/api/v1/things"),
    );

    expect(response.status).toBe(201);
  });
});

describe("respuesta de error", () => {
  it("traduce un ApiError lanzado por el handler a su código HTTP", async () => {
    const route = createApiRoute({
      handler: async () => {
        throw new ApiError("conflict", "el recurso ya existe");
      },
    });

    const response = await route(
      new NextRequest("http://localhost/api/v1/things"),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: { code: "conflict", message: "el recurso ya existe" },
    });
  });
});

describe("validación", () => {
  const schema = z.object({ name: z.string().min(1), age: z.number() });

  it("rechaza un cuerpo inválido con 400 y nombra los campos, sin llamar al handler", async () => {
    const handler = vi.fn(async () => ({ data: null }));
    const route = createApiRoute({ schema, handler });

    const response = await route(
      postRequest(
        "http://localhost/api/v1/players",
        JSON.stringify({ name: "" }),
      ),
    );

    expect(response.status).toBe(400);
    const body = (await response.json()) as {
      error: { code: string; message: string };
    };
    expect(body.error.code).toBe("validation_error");
    expect(body.error.message).toContain("name");
    expect(body.error.message).toContain("age");
    expect(handler).not.toHaveBeenCalled();
  });

  it("rechaza un cuerpo que no es JSON válido con 400 sin lanzar una excepción sin manejar", async () => {
    const handler = vi.fn(async () => ({ data: null }));
    const route = createApiRoute({ schema, handler });

    const response = await route(
      postRequest("http://localhost/api/v1/players", "{not json"),
    );

    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("validation_error");
    expect(handler).not.toHaveBeenCalled();
  });

  it("acepta un cuerpo válido y lo pasa al handler ya tipado", async () => {
    const handler = vi.fn(
      async ({ body }: { body: { name: string; age: number } }) => ({
        data: { welcome: body.name },
      }),
    );
    const route = createApiRoute({ schema, handler });

    const response = await route(
      postRequest(
        "http://localhost/api/v1/players",
        JSON.stringify({ name: "Ana", age: 30 }),
      ),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: { welcome: "Ana" },
    });
  });
});

describe("error inesperado", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("produce 500 con mensaje genérico y no filtra el mensaje original", async () => {
    const route = createApiRoute({
      handler: async () => {
        throw new Error('relation "clubs" does not exist: pg error 42P01');
      },
    });
    vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await route(
      new NextRequest("http://localhost/api/v1/things"),
    );

    expect(response.status).toBe(500);
    const body = (await response.json()) as {
      error: { code: string; message: string };
    };
    expect(body.error.code).toBe("internal_error");
    expect(body.error.message).not.toContain("pg error");
    expect(body.error.message).not.toContain("clubs");
  });

  it("registra el detalle original del lado del servidor", async () => {
    const originalError = new Error('relation "clubs" does not exist');
    const route = createApiRoute({
      handler: async () => {
        throw originalError;
      },
    });
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    await route(new NextRequest("http://localhost/api/v1/things"));

    expect(consoleError).toHaveBeenCalledWith(
      expect.any(String),
      originalError,
    );
  });
});

describe("método no permitido", () => {
  it("responde 405 con la forma de error para un método no implementado", async () => {
    const apiModule = createApiModule({
      GET: createApiRoute({ handler: async () => ({ data: null }) }),
    });

    const response = await apiModule.POST(
      new NextRequest("http://localhost/api/v1/things", { method: "POST" }),
    );

    expect(response.status).toBe(405);
    await expect(response.json()).resolves.toEqual({
      error: { code: "method_not_allowed", message: expect.any(String) },
    });
  });

  it("mantiene el método implementado funcionando", async () => {
    const apiModule = createApiModule({
      GET: createApiRoute({ handler: async () => ({ data: { ok: true } }) }),
    });

    const response = await apiModule.GET(
      new NextRequest("http://localhost/api/v1/things"),
    );

    expect(response.status).toBe(200);
  });
});

describe("ruta desconocida", () => {
  it("cada método del módulo de no-encontrado responde 404 con la forma de error", async () => {
    const apiModule = createNotFoundModule();

    const response = await apiModule.GET(
      new NextRequest("http://localhost/api/v1/no-existe"),
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: { code: "not_found", message: expect.any(String) },
    });
  });

  it("responde 404 también para métodos distintos de GET", async () => {
    const apiModule = createNotFoundModule();

    const response = await apiModule.DELETE(
      new NextRequest("http://localhost/api/v1/no-existe", {
        method: "DELETE",
      }),
    );

    expect(response.status).toBe(404);
  });
});
