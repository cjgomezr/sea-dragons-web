import { describe, expect, it } from "vitest";
import {
  ApiError,
  apiError,
  apiSuccess,
  type ApiErrorCode,
} from "@/lib/api/response";

describe("apiSuccess", () => {
  it("wraps the value in data and defaults to 200", async () => {
    const response = apiSuccess({ id: "1" });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ data: { id: "1" } });
  });

  it("uses 201 when the handler declares creation", async () => {
    const response = apiSuccess({ id: "1" }, 201);

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({ data: { id: "1" } });
  });

  it("never mixes data with an error field", async () => {
    const response = apiSuccess({ id: "1" });

    const body = (await response.json()) as Record<string, unknown>;
    expect(body).not.toHaveProperty("error");
  });
});

describe("apiError", () => {
  const HTTP_STATUS_BY_CODE: Record<ApiErrorCode, number> = {
    validation_error: 400,
    unauthenticated: 401,
    forbidden: 403,
    not_found: 404,
    conflict: 409,
    business_rule: 422,
    gone: 410,
    rate_limited: 429,
    method_not_allowed: 405,
    service_unavailable: 503,
    internal_error: 500,
  };

  it.each(Object.entries(HTTP_STATUS_BY_CODE))(
    "maps %s to HTTP %i",
    async (code, expectedStatus) => {
      const response = apiError(code as ApiErrorCode, "algo salió mal");

      expect(response.status).toBe(expectedStatus);
      await expect(response.json()).resolves.toEqual({
        error: { code, message: "algo salió mal" },
      });
    },
  );
});

describe("apiError con motivo", () => {
  it("añade el motivo cuando un mismo código cubre casos que el cliente explica distinto", async () => {
    const response = apiError("gone", "ya no sirve", "password_rejected");

    await expect(response.json()).resolves.toEqual({
      error: {
        code: "gone",
        message: "ya no sirve",
        reason: "password_rejected",
      },
    });
  });
});

describe("ApiError", () => {
  it("carries the reason when it has one", () => {
    const error = new ApiError("gone", "ya no sirve", "link_unusable");

    expect(error.reason).toBe("link_unusable");
  });

  it("carries the code and message it was created with", () => {
    const error = new ApiError("conflict", "el recurso ya existe");

    expect(error.code).toBe("conflict");
    expect(error.message).toBe("el recurso ya existe");
    expect(error).toBeInstanceOf(Error);
  });
});
