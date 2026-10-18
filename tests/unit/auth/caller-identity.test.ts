import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { findMemberIdentity } from "@/lib/auth/caller-identity";

/**
 * El nombre y el correo que el menú de la cuenta (#716) pone arriba, leídos
 * de la fila de miembro de quien tiene la sesión.
 */

const USER_ID = "00000000-0000-4000-8000-000000000001";

type Query = { table: string; columns: string; column: string; value: string };

function fakeClient(result: {
  data: Record<string, unknown> | null;
  error: { message: string } | null;
}): { client: SupabaseClient; queries: Query[] } {
  const queries: Query[] = [];
  const client = {
    from: (table: string) => ({
      select: (columns: string) => ({
        eq: (column: string, value: string) => {
          queries.push({ table, columns, column, value });
          return { maybeSingle: async () => result };
        },
      }),
    }),
  } as unknown as SupabaseClient;
  return { client, queries };
}

describe("identidad de quien tiene la sesión", () => {
  it("lee el nombre y el correo de su fila de miembro", async () => {
    const { client, queries } = fakeClient({
      data: { full_name: "Camilo Gomez", email: "camilo@seadragons.club" },
      error: null,
    });

    const identity = await findMemberIdentity(client, USER_ID);

    expect(identity).toEqual({
      fullName: "Camilo Gomez",
      email: "camilo@seadragons.club",
    });
    expect(queries).toEqual([
      {
        table: "members",
        columns: "full_name, email",
        column: "user_id",
        value: USER_ID,
      },
    ]);
  });

  it("devuelve null cuando no hay fila de miembro", async () => {
    const { client } = fakeClient({ data: null, error: null });

    await expect(findMemberIdentity(client, USER_ID)).resolves.toBeNull();
  });

  it("falla con contexto si la base no contesta", async () => {
    const { client } = fakeClient({
      data: null,
      error: { message: "connection refused" },
    });

    await expect(findMemberIdentity(client, USER_ID)).rejects.toThrow(
      /connection refused/,
    );
  });

  it("falla si la fila llega sin nombre", async () => {
    const { client } = fakeClient({
      data: { full_name: null, email: "camilo@seadragons.club" },
      error: null,
    });

    await expect(findMemberIdentity(client, USER_ID)).rejects.toThrow(
      /full_name/,
    );
  });
});
