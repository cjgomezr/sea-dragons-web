import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { GET, POST } from "@/app/api/v1/[...notFound]/route";

describe("ruta desconocida bajo /api/v1", () => {
  it("responde 404 con la forma de error de la convención para GET", async () => {
    const response = await GET(
      new NextRequest("http://localhost/api/v1/no-existe"),
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: { code: "not_found", message: expect.any(String) },
    });
  });

  it("responde 404 también para otros métodos HTTP", async () => {
    const response = await POST(
      new NextRequest("http://localhost/api/v1/no-existe", { method: "POST" }),
    );

    expect(response.status).toBe(404);
  });
});
