import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ORIGINAL_ENV = { ...process.env };

describe("health", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env = { ...ORIGINAL_ENV };
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("responde con la envoltura data cuando Supabase está configurado y alcanzable", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
    vi.doMock("@supabase/supabase-js", () => ({
      createClient: () => ({
        from: () => ({
          select: () => ({
            limit: async () => ({ error: null }),
          }),
        }),
      }),
    }));

    const { GET } = await import("@/app/api/v1/health/route");
    const response = await GET(
      new NextRequest("http://localhost/api/v1/health"),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: { status: "ok", database: "ok", detail: "database reachable" },
    });
  });

  it("responde 503 con la forma de error cuando Supabase no está configurado", async () => {
    const { GET } = await import("@/app/api/v1/health/route");
    const response = await GET(
      new NextRequest("http://localhost/api/v1/health"),
    );

    expect(response.status).toBe(503);
    const body = (await response.json()) as {
      error: { code: string; message: string };
    };
    expect(body.error.code).toBe("service_unavailable");
    expect(body.error.message).toContain("NEXT_PUBLIC_SUPABASE_URL");
  });

  it("responde 405 con la forma de error para un método no soportado", async () => {
    const { POST } = await import("@/app/api/v1/health/route");
    const response = await POST(
      new NextRequest("http://localhost/api/v1/health", { method: "POST" }),
    );

    expect(response.status).toBe(405);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("method_not_allowed");
  });
});
