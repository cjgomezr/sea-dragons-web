import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import {
  createDirectoryEmailQuotaGateway,
  createDirectoryEmailRecipientsGateway,
} from "@/lib/directory/supabase-directory-email-gateways";

/**
 * El adaptador del correo del directorio (#501): cómo lee la respuesta de las
 * funciones de `0059_directory_email_sends.sql` y las filas de los socios.
 * Lo que hacen esas funciones lo prueba su test de migración.
 */

const CLUB_ID = "5c1ab000-0000-4000-8000-000000000001";
const SENDER_ID = "a0a0a0a0-0000-4000-8000-00000000000a";
const REQUEST_ID = "7e7e7e7e-0000-4000-8000-000000000001";
const SEND_ID = "5e5e5e5e-0000-4000-8000-000000000001";
const WINDOW_START = new Date("2026-10-06T09:00:00.000Z");

type Answer = { readonly data: unknown; readonly error: unknown };

type Recorded = {
  readonly rpcs: { name: string; args: unknown }[];
  readonly updates: { values: unknown; filters: unknown[][] }[];
  readonly selects: { table: string; filters: unknown[][] }[];
};

/** Sólo los eslabones que usa el adaptador. */
function fakeClient(answer: Answer): {
  readonly client: SupabaseClient;
  readonly recorded: Recorded;
} {
  const recorded: Recorded = { rpcs: [], updates: [], selects: [] };
  const client = {
    async rpc(name: string, args: unknown) {
      recorded.rpcs.push({ name, args });
      return answer;
    },
    from(table: string) {
      return {
        update(values: unknown) {
          const filters: unknown[][] = [];
          recorded.updates.push({ values, filters });
          return {
            eq(...filter: unknown[]) {
              filters.push(filter);
              return { select: async () => answer };
            },
          };
        },
        select() {
          const filters: unknown[][] = [];
          recorded.selects.push({ table, filters });
          return {
            eq(...filter: unknown[]) {
              filters.push(filter);
              return {
                async in(...inFilter: unknown[]) {
                  filters.push(inFilter);
                  return answer;
                },
              };
            },
          };
        },
      };
    },
  };
  return { client: client as unknown as SupabaseClient, recorded };
}

const RESERVATION = {
  clubId: CLUB_ID,
  senderId: SENDER_ID,
  requestId: REQUEST_ID,
  recipientCount: 3,
  limit: 50,
  windowStart: WINDOW_START,
};

describe("el cupo del directorio en Supabase", () => {
  it("reserva con la función de la base y devuelve el envío", async () => {
    const fake = fakeClient({
      data: { outcome: "reserved", send_id: SEND_ID },
      error: null,
    });

    const reservation = await createDirectoryEmailQuotaGateway(
      fake.client,
    ).reserve(RESERVATION);

    expect(reservation).toEqual({ kind: "reserved", sendId: SEND_ID });
    expect(fake.recorded.rpcs).toEqual([
      {
        name: "reserve_directory_email_quota",
        args: {
          target_club_id: CLUB_ID,
          sender_user_id: SENDER_ID,
          send_request_id: REQUEST_ID,
          recipient_count: 3,
          quota_limit: 50,
          window_start: WINDOW_START.toISOString(),
        },
      },
    ]);
  });

  it("lee que no cabe y cuántos caben", async () => {
    const fake = fakeClient({
      data: { outcome: "exceeded", remaining: 2 },
      error: null,
    });

    await expect(
      createDirectoryEmailQuotaGateway(fake.client).reserve(RESERVATION),
    ).resolves.toEqual({ kind: "exceeded", remaining: 2 });
  });

  it("lee que la petición ya se hizo", async () => {
    const fake = fakeClient({ data: { outcome: "duplicate" }, error: null });

    await expect(
      createDirectoryEmailQuotaGateway(fake.client).reserve(RESERVATION),
    ).resolves.toEqual({ kind: "duplicate" });
  });

  it("una respuesta que no reconoce es un error, no un envío", async () => {
    const fake = fakeClient({ data: { outcome: "quizá" }, error: null });

    await expect(
      createDirectoryEmailQuotaGateway(fake.client).reserve(RESERVATION),
    ).rejects.toThrow("reserve_directory_email_quota");
  });

  it("un error de la base al reservar sube con el nombre de la función", async () => {
    const fake = fakeClient({
      data: null,
      error: { message: "permission denied" },
    });

    await expect(
      createDirectoryEmailQuotaGateway(fake.client).reserve(RESERVATION),
    ).rejects.toThrow("permission denied");
  });

  it("cuenta con la función de la base", async () => {
    const fake = fakeClient({ data: 12, error: null });

    const count = await createDirectoryEmailQuotaGateway(
      fake.client,
    ).countSentSince(WINDOW_START);

    expect(count).toBe(12);
    expect(fake.recorded.rpcs).toEqual([
      {
        name: "count_directory_emails_since",
        args: { window_start: WINDOW_START.toISOString() },
      },
    ]);
  });

  it("apunta cuántos salieron en la fila del envío", async () => {
    const fake = fakeClient({ data: [{ id: SEND_ID }], error: null });

    await createDirectoryEmailQuotaGateway(fake.client).settle(SEND_ID, 2);

    expect(fake.recorded.updates).toEqual([
      { values: { sent_count: 2 }, filters: [["id", SEND_ID]] },
    ]);
  });

  it("falla si el envío que apunta no existe", async () => {
    const fake = fakeClient({ data: [], error: null });

    await expect(
      createDirectoryEmailQuotaGateway(fake.client).settle(SEND_ID, 2),
    ).rejects.toThrow(SEND_ID);
  });
});

describe("los destinatarios en Supabase", () => {
  it("lee sólo a los socios pedidos de ese club, con su idioma", async () => {
    const fake = fakeClient({
      data: [
        {
          user_id: SENDER_ID,
          full_name: "Ana Admin",
          email: "ana@club.test",
          account_status: "active",
          email_locale: "en",
        },
      ],
      error: null,
    });

    const found = await createDirectoryEmailRecipientsGateway(
      fake.client,
    ).findEmailRecipients(CLUB_ID, [SENDER_ID]);

    expect(found).toEqual([
      {
        userId: SENDER_ID,
        fullName: "Ana Admin",
        email: "ana@club.test",
        status: "active",
        locale: "en",
      },
    ]);
    expect(fake.recorded.selects).toEqual([
      {
        table: "members",
        filters: [
          ["club_id", CLUB_ID],
          ["user_id", [SENDER_ID]],
        ],
      },
    ]);
  });

  it("un error de la base sube con el club", async () => {
    const fake = fakeClient({ data: null, error: { message: "timeout" } });

    await expect(
      createDirectoryEmailRecipientsGateway(fake.client).findEmailRecipients(
        CLUB_ID,
        [SENDER_ID],
      ),
    ).rejects.toThrow(CLUB_ID);
  });
});
