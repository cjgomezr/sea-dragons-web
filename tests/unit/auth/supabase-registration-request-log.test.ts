import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { createSupabaseRegistrationRequestLog } from "@/lib/auth/supabase-registration-request-log";

const CLUB_ID = "6f1d2c3b-4a59-4e6f-8b70-1c2d3e4f5a6b";
const SECRET = "una-clave-de-servicio-cualquiera";
const NOW = new Date("2026-09-16T10:00:00.000Z");
const WINDOW_START = new Date("2026-09-16T09:45:00.000Z");
const EMAIL = "nerea@example.test";
const BUCKET = "203.0.113.7";

type Answer = {
  readonly count?: number | null;
  readonly error?: { readonly message: string } | null;
};

type Recorded = {
  readonly tables: string[];
  readonly inserts: Record<string, unknown>[];
  readonly equalities: unknown[][];
  readonly filters: unknown[][];
};

/** Un cliente de mentira con sólo la cadena que usa el adaptador. */
function fakeClient(answer: Answer = {}): {
  readonly client: SupabaseClient;
  readonly recorded: Recorded;
} {
  const recorded: Recorded = {
    tables: [],
    inserts: [],
    equalities: [],
    filters: [],
  };
  const result = { count: answer.count ?? null, error: answer.error ?? null };
  const client = {
    from(table: string) {
      recorded.tables.push(table);
      return {
        select() {
          return {
            eq(...first: unknown[]) {
              recorded.equalities.push(first);
              return {
                eq(...second: unknown[]) {
                  recorded.equalities.push(second);
                  return {
                    async gte(...filter: unknown[]) {
                      recorded.filters.push(filter);
                      return result;
                    },
                  };
                },
              };
            },
          };
        },
        async insert(row: Record<string, unknown>) {
          recorded.inserts.push(row);
          return { error: result.error };
        },
      };
    },
  };
  return { client: client as unknown as SupabaseClient, recorded };
}

function logOf(client: SupabaseClient) {
  return createSupabaseRegistrationRequestLog(client, {
    clubId: CLUB_ID,
    hashSecret: SECRET,
  });
}

function record(
  client: SupabaseClient,
  subject: { readonly kind: "ip" | "email"; readonly value: string },
): Promise<number> {
  return logOf(client).recordAndCountRecent({
    subject,
    now: NOW,
    windowStart: WINDOW_START,
  });
}

describe("bitácora del límite del registro en Supabase", () => {
  it("anota la petición con el club, el tipo de sujeto y el instante", async () => {
    const fake = fakeClient({ count: 1 });

    await record(fake.client, { kind: "email", value: EMAIL });

    expect(fake.recorded.tables).toEqual([
      "registration_requests",
      "registration_requests",
    ]);
    expect(fake.recorded.inserts).toHaveLength(1);
    expect(fake.recorded.inserts[0]).toMatchObject({
      club_id: CLUB_ID,
      subject_kind: "email",
      requested_at: NOW.toISOString(),
    });
  });

  it("no guarda el correo ni la IP en claro", async () => {
    const fake = fakeClient({ count: 1 });

    await record(fake.client, { kind: "email", value: EMAIL });
    await record(fake.client, { kind: "ip", value: BUCKET });

    const escrito = JSON.stringify(fake.recorded.inserts);
    expect(escrito).not.toContain(EMAIL);
    expect(escrito).not.toContain(BUCKET);
  });

  it("cuenta sólo las del mismo sujeto desde el inicio de la ventana", async () => {
    const fake = fakeClient({ count: 4 });

    const count = await record(fake.client, { kind: "ip", value: BUCKET });

    expect(count).toBe(4);
    expect(fake.recorded.equalities).toEqual([
      ["subject_kind", "ip"],
      ["subject_hash", fake.recorded.inserts[0]?.subject_hash],
    ]);
    expect(fake.recorded.filters).toEqual([
      ["requested_at", WINDOW_START.toISOString()],
    ]);
  });

  it("anota antes de contar, para que una ráfaga en paralelo no lea el mismo contador", async () => {
    const fake = fakeClient({ count: 1 });

    await record(fake.client, { kind: "ip", value: BUCKET });

    expect(fake.recorded.inserts).toHaveLength(1);
    expect(fake.recorded.filters).toHaveLength(1);
  });

  it("da hashes distintos al mismo texto según el tipo de sujeto", async () => {
    const comoIp = fakeClient({ count: 1 });
    const comoCorreo = fakeClient({ count: 1 });

    await record(comoIp.client, { kind: "ip", value: EMAIL });
    await record(comoCorreo.client, { kind: "email", value: EMAIL });

    expect(comoIp.recorded.inserts[0]?.subject_hash).not.toBe(
      comoCorreo.recorded.inserts[0]?.subject_hash,
    );
  });

  it("da hashes distintos con claves distintas, para que un volcado no se pueda romper por fuerza bruta", async () => {
    const fake = fakeClient({ count: 1 });
    const otra = fakeClient({ count: 1 });

    await logOf(fake.client).recordAndCountRecent({
      subject: { kind: "ip", value: BUCKET },
      now: NOW,
      windowStart: WINDOW_START,
    });
    await createSupabaseRegistrationRequestLog(otra.client, {
      clubId: CLUB_ID,
      hashSecret: "otra-clave",
    }).recordAndCountRecent({
      subject: { kind: "ip", value: BUCKET },
      now: NOW,
      windowStart: WINDOW_START,
    });

    expect(fake.recorded.inserts[0]?.subject_hash).not.toBe(
      otra.recorded.inserts[0]?.subject_hash,
    );
  });

  it("un error al anotar sube nombrando la tabla", async () => {
    const fake = fakeClient({ error: { message: "violates foreign key" } });

    await expect(
      record(fake.client, { kind: "ip", value: BUCKET }),
    ).rejects.toThrow(/registration_requests.*violates foreign key/);
  });

  it("un error al contar sube nombrando la tabla", async () => {
    const fake = fakeClient({ error: { message: "permission denied" } });

    await expect(
      record(fake.client, { kind: "ip", value: BUCKET }),
    ).rejects.toThrow(/registration_requests.*permission denied/);
  });

  it("una cuenta sin número sube como error en vez de leerse como cero", async () => {
    const fake = fakeClient({ count: null });

    await expect(
      record(fake.client, { kind: "ip", value: BUCKET }),
    ).rejects.toThrow(/registration_requests/);
  });

  it("ningún mensaje de error lleva la dirección", async () => {
    const fake = fakeClient({ error: { message: "permission denied" } });

    const error = await record(fake.client, {
      kind: "email",
      value: EMAIL,
    }).catch((thrown: unknown) => thrown);

    expect(String(error)).not.toContain(EMAIL);
  });
});
