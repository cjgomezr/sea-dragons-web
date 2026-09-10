import { describe, expect, it } from "vitest";
import { readSupabaseProjectRef } from "@/lib/supabase/config";

describe("readSupabaseProjectRef", () => {
  it("extrae el ref del subdominio de la URL configurada", () => {
    expect(
      readSupabaseProjectRef({
        NEXT_PUBLIC_SUPABASE_URL: "https://ejemplo123.supabase.co",
      }),
    ).toBe("ejemplo123");
  });

  it("devuelve null cuando no hay URL configurada", () => {
    expect(readSupabaseProjectRef({})).toBeNull();
  });

  it("devuelve null cuando el host no es de supabase.co", () => {
    expect(
      readSupabaseProjectRef({
        NEXT_PUBLIC_SUPABASE_URL: "https://api.seadragons.example",
      }),
    ).toBeNull();
  });

  it("devuelve null cuando el valor no es una URL", () => {
    expect(
      readSupabaseProjectRef({ NEXT_PUBLIC_SUPABASE_URL: "no-es-una-url" }),
    ).toBeNull();
  });
});
