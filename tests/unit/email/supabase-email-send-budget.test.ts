import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { createSupabaseEmailSendBudget } from "@/lib/email/supabase-email-send-budget";

const CLUB_ID = "6f1d2c3b-4a59-4e6f-8b70-1c2d3e4f5a6b";
const WINDOW_START = new Date("2026-09-15T10:00:00.000Z");
const NOW = new Date("2026-09-16T10:00:00.000Z");

type Answer = {
  readonly count?: number | null;
  readonly error?: { readonly message: string } | null;
};

type Recorded = {
  readonly tables: string[];
  readonly selects: unknown[][];
  readonly filters: unknown[][];
  readonly inserts: unknown[];
};

/** Un cliente de mentira con sólo la cadena que usa el adaptador. Apunta lo
 * que recibe cada eslabón y contesta lo que pida el test. */
function fakeClient(answer: Answer): {
  readonly client: SupabaseClient;
  readonly recorded: Recorded;
} {
  const recorded: Recorded = {
    tables: [],
    selects: [],
    filters: [],
    inserts: [],
  };
  const result = { count: answer.count ?? null, error: answer.error ?? null };
  const client = {
    from(table: string) {
      recorded.tables.push(table);
      return {
        select(...args: unknown[]) {
          recorded.selects.push(args);
          return {
            async gte(...filter: unknown[]) {
              recorded.filters.push(filter);
              return result;
            },
          };
        },
        async insert(row: unknown) {
          recorded.inserts.push(row);
          return { error: result.error };
        },
      };
    },
  };
  return { client: client as unknown as SupabaseClient, recorded };
}

describe("cupo propio de correos en Supabase", () => {
  it("cuenta sólo las peticiones desde el inicio de la ventana", async () => {
    const fake = fakeClient({ count: 7 });

    const count = await createSupabaseEmailSendBudget(
      fake.client,
      CLUB_ID,
    ).countSince(WINDOW_START);

    expect(count).toBe(7);
    expect(fake.recorded.tables).toEqual(["email_send_requests"]);
    expect(fake.recorded.selects).toEqual([
      ["id", { count: "exact", head: true }],
    ]);
    expect(fake.recorded.filters).toEqual([
      ["requested_at", WINDOW_START.toISOString()],
    ]);
  });

  it("un error al contar sube nombrando la tabla", async () => {
    const fake = fakeClient({ error: { message: "permission denied" } });

    await expect(
      createSupabaseEmailSendBudget(fake.client, CLUB_ID).countSince(
        WINDOW_START,
      ),
    ).rejects.toThrow(/email_send_requests.*permission denied/);
  });

  it("una cuenta sin número sube como error en vez de leerse como cero", async () => {
    const fake = fakeClient({ count: null });

    await expect(
      createSupabaseEmailSendBudget(fake.client, CLUB_ID).countSince(
        WINDOW_START,
      ),
    ).rejects.toThrow(/email_send_requests/);
  });

  it("anota la petición con el club y el instante", async () => {
    const fake = fakeClient({});

    await createSupabaseEmailSendBudget(fake.client, CLUB_ID).recordRequest(
      NOW,
    );

    expect(fake.recorded.tables).toEqual(["email_send_requests"]);
    expect(fake.recorded.inserts).toEqual([
      { club_id: CLUB_ID, requested_at: NOW.toISOString() },
    ]);
  });

  it("un error al anotar sube nombrando la tabla", async () => {
    const fake = fakeClient({ error: { message: "violates foreign key" } });

    await expect(
      createSupabaseEmailSendBudget(fake.client, CLUB_ID).recordRequest(NOW),
    ).rejects.toThrow(/email_send_requests.*violates foreign key/);
  });
});
