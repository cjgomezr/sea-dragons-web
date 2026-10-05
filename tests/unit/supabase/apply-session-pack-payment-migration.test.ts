import { expect, it } from "vitest";
import {
  type TemporaryDatabase,
  applyRepositoryMigrations,
  describeConPostgres,
  migratedDatabase,
} from "../../support/postgres";

/**
 * `0057_apply_session_pack_payment.sql` contra un Postgres desechable (#471,
 * RF-5 del PRD de E13). Un pack pagado escribe el id del evento, el pago y el
 * crédito del libro todo junto; repetido no suma otra vez, y el Casual que
 * estaba `pending` queda `active` por el trigger de `0053`.
 */

const SEEDED_CLUB = "victoria-seadragons";
const PAYMENT_INTENT_ID = "pi_TestSeadragonsPack";
const FUNCTION_SIGNATURE =
  "public.apply_session_pack_payment(text, text, timestamptz, uuid, uuid, jsonb, integer)";

type Member = { readonly clubId: string; readonly userId: string };

async function seedCasual(
  database: TemporaryDatabase,
  plan = "Casual",
): Promise<Member> {
  const clubId = await database.query(
    `select id from public.clubs where slug = '${SEEDED_CLUB}'`,
  );
  const userId = await database.query(
    "insert into auth.users (id) values (gen_random_uuid()) returning id",
  );
  await database.query(
    `insert into public.members
       (club_id, user_id, full_name, email, account_status)
     values ('${clubId}', '${userId}', 'Carla Casual',
             '${userId}@example.test', 'active')`,
  );
  await database.query(
    `insert into public.memberships (user_id, club_id, plan, status)
     values ('${userId}', '${clubId}', '${plan}', 'pending')`,
  );
  return { clubId, userId };
}

function applyPack(
  database: TemporaryDatabase,
  request: {
    readonly member: Member;
    readonly eventId?: string;
    readonly sessions?: number;
  },
): Promise<string> {
  const payment = {
    stripe_charge_id: PAYMENT_INTENT_ID,
    amount_cents: 7500,
    currency: "aud",
    description: "Casual session pack (5 sessions)",
    paid_at: "2026-10-05T09:00:00.000Z",
  };
  return database.query(
    `select public.apply_session_pack_payment(
       '${request.eventId ?? "evt_pack_1"}', 'checkout.session.completed',
       '2026-10-05T09:00:00Z', '${request.member.userId}',
       '${request.member.clubId}', '${JSON.stringify(payment)}'::jsonb,
       ${request.sessions ?? 5})`,
  );
}

function balanceOf(
  database: TemporaryDatabase,
  member: Member,
): Promise<string> {
  return database.query(
    `select coalesce(sum(delta), 0) from public.session_ledger
      where user_id = '${member.userId}'`,
  );
}

function statusOf(
  database: TemporaryDatabase,
  member: Member,
): Promise<string> {
  return database.query(
    `select status from public.memberships where user_id = '${member.userId}'`,
  );
}

describeConPostgres("apply_session_pack_payment", () => {
  it("guarda el pago del pack por su PaymentIntent y suma sus sesiones", async () => {
    const database = await migratedDatabase();
    const casual = await seedCasual(database);

    const outcome = await applyPack(database, { member: casual });

    expect(outcome).toBe("applied");
    await expect(
      database.query(
        `select stripe_charge_id || '|' || amount_cents || '|' || currency
                || '|' || status || '|' || description
           from public.payments where user_id = '${casual.userId}'`,
      ),
    ).resolves.toBe(
      `${PAYMENT_INTENT_ID}|7500|aud|paid|Casual session pack (5 sessions)`,
    );
    await expect(balanceOf(database, casual)).resolves.toBe("5");
  });

  it("deja active al Casual que estaba pending", async () => {
    const database = await migratedDatabase();
    const casual = await seedCasual(database);

    await applyPack(database, { member: casual });

    await expect(statusOf(database, casual)).resolves.toBe("active");
  });

  it("el mismo evento dos veces escribe y suma una sola vez", async () => {
    const database = await migratedDatabase();
    const casual = await seedCasual(database);
    await applyPack(database, { member: casual });

    const outcome = await applyPack(database, { member: casual });

    expect(outcome).toBe("duplicate");
    await expect(balanceOf(database, casual)).resolves.toBe("5");
    await expect(
      database.query(
        `select count(*) from public.payments where user_id = '${casual.userId}'`,
      ),
    ).resolves.toBe("1");
  });

  it("otro evento del mismo pago no lo duplica ni vuelve a sumar", async () => {
    const database = await migratedDatabase();
    const casual = await seedCasual(database);
    await applyPack(database, { member: casual, eventId: "evt_pack_1" });

    const outcome = await applyPack(database, {
      member: casual,
      eventId: "evt_pack_2",
    });

    expect(outcome).toBe("applied");
    await expect(balanceOf(database, casual)).resolves.toBe("5");
    await expect(
      database.query(
        `select count(*) from public.payments where user_id = '${casual.userId}'`,
      ),
    ).resolves.toBe("1");
  });

  it("si el crédito falla no deja ni el pago ni el evento", async () => {
    const database = await migratedDatabase();
    const casual = await seedCasual(database);

    const failed = await database.attempt(
      `select public.apply_session_pack_payment(
         'evt_pack_cero', 'checkout.session.completed', now(),
         '${casual.userId}', '${casual.clubId}',
         '{"stripe_charge_id":"pi_cero","amount_cents":0,"currency":"aud",
           "description":"x","paid_at":"2026-10-05T09:00:00Z"}'::jsonb, 0)`,
    );

    expect(failed.code).not.toBe(0);
    await expect(
      database.query(
        "select count(*) from public.stripe_events where id = 'evt_pack_cero'",
      ),
    ).resolves.toBe("0");
    await expect(
      database.query(
        "select count(*) from public.payments where stripe_charge_id = 'pi_cero'",
      ),
    ).resolves.toBe("0");
  });

  it("a un Full le guarda las sesiones congeladas sin tocar su estado", async () => {
    const database = await migratedDatabase();
    const full = await seedCasual(database, "Full");

    await applyPack(database, { member: full });

    await expect(balanceOf(database, full)).resolves.toBe("5");
    await expect(statusOf(database, full)).resolves.toBe("pending");
  });

  it("sólo service_role la ejecuta", async () => {
    const database = await migratedDatabase();

    const grantees = await database.query(
      `select string_agg(r.rolname, ',' order by r.rolname)
         from pg_roles r
        where r.rolname in ('anon', 'authenticated', 'service_role')
          and has_function_privilege(r.rolname, '${FUNCTION_SIGNATURE}',
                                     'execute')`,
    );

    expect(grantees).toBe("service_role");
  });

  it("es idempotente: aplicada dos veces no falla ni cambia nada", async () => {
    const database = await migratedDatabase();
    const despuesDeLaPrimera = await database.snapshot();

    const segunda = await applyRepositoryMigrations(database);

    expect(segunda.code, segunda.stderr).toBe(0);
    expect(await database.snapshot()).toBe(despuesDeLaPrimera);
  });

  it("schema-expected.txt declara lo que la migración deja", async () => {
    const database = await migratedDatabase();

    const comprobacion = await database.checkSchema();

    expect(comprobacion.code, comprobacion.stdout + comprobacion.stderr).toBe(
      0,
    );
  });
});
