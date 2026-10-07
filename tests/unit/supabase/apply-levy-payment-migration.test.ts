import { expect, it } from "vitest";
import {
  type TemporaryDatabase,
  applyRepositoryMigrations,
  describeConPostgres,
  migratedDatabase,
} from "../../support/postgres";

/**
 * `0060_levy_payments.sql` contra un Postgres desechable (#473, RF-6 del PRD
 * de E13, D4). Un levy pagado escribe el id del evento y el pago con el
 * producto de Stripe que lo identifica; repetido no escribe otra vez, y la
 * membresía no cambia.
 */

const SEEDED_CLUB = "victoria-seadragons";
const PAYMENT_INTENT_ID = "pi_TestSeadragonsLevy";
const LEVY_PRODUCT_ID = "prod_TestNationals";
const FUNCTION_SIGNATURE =
  "public.apply_levy_payment(text, text, timestamptz, uuid, uuid, jsonb)";

type Member = { readonly clubId: string; readonly userId: string };

async function seedMember(database: TemporaryDatabase): Promise<Member> {
  const clubId = await database.query(
    `select id from public.clubs where slug = '${SEEDED_CLUB}'`,
  );
  const userId = await database.query(
    "insert into auth.users (id) values (gen_random_uuid()) returning id",
  );
  await database.query(
    `insert into public.members
       (club_id, user_id, full_name, email, account_status)
     values ('${clubId}', '${userId}', 'Lola Levy',
             '${userId}@example.test', 'active')`,
  );
  await database.query(
    `insert into public.memberships (user_id, club_id, plan, status)
     values ('${userId}', '${clubId}', 'Full', 'past_due')`,
  );
  return { clubId, userId };
}

function applyLevy(
  database: TemporaryDatabase,
  request: { readonly member: Member; readonly eventId?: string },
): Promise<string> {
  const payment = {
    stripe_charge_id: PAYMENT_INTENT_ID,
    stripe_product_id: LEVY_PRODUCT_ID,
    amount_cents: 8000,
    currency: "aud",
    description: "Nationals 2026",
    paid_at: "2026-10-07T09:00:00.000Z",
  };
  return database.query(
    `select public.apply_levy_payment(
       '${request.eventId ?? "evt_levy_1"}', 'checkout.session.completed',
       '2026-10-07T09:00:00Z', '${request.member.userId}',
       '${request.member.clubId}', '${JSON.stringify(payment)}'::jsonb)`,
  );
}

function paymentCountOf(
  database: TemporaryDatabase,
  member: Member,
): Promise<string> {
  return database.query(
    `select count(*) from public.payments where user_id = '${member.userId}'`,
  );
}

describeConPostgres("apply_levy_payment", () => {
  it("guarda el pago del levy por su PaymentIntent con el producto y el nombre", async () => {
    const database = await migratedDatabase();
    const member = await seedMember(database);

    const outcome = await applyLevy(database, { member });

    expect(outcome).toBe("applied");
    await expect(
      database.query(
        `select stripe_charge_id || '|' || stripe_product_id || '|'
                || amount_cents || '|' || currency || '|' || status || '|'
                || description
           from public.payments where user_id = '${member.userId}'`,
      ),
    ).resolves.toBe(
      `${PAYMENT_INTENT_ID}|${LEVY_PRODUCT_ID}|8000|aud|paid|Nationals 2026`,
    );
  });

  it("no toca la membresía", async () => {
    const database = await migratedDatabase();
    const member = await seedMember(database);

    await applyLevy(database, { member });

    await expect(
      database.query(
        `select status from public.memberships
          where user_id = '${member.userId}'`,
      ),
    ).resolves.toBe("past_due");
  });

  it("el mismo evento dos veces escribe una sola vez", async () => {
    const database = await migratedDatabase();
    const member = await seedMember(database);
    await applyLevy(database, { member });

    const outcome = await applyLevy(database, { member });

    expect(outcome).toBe("duplicate");
    await expect(paymentCountOf(database, member)).resolves.toBe("1");
  });

  it("otro evento del mismo pago no lo duplica", async () => {
    const database = await migratedDatabase();
    const member = await seedMember(database);
    await applyLevy(database, { member, eventId: "evt_levy_1" });

    const outcome = await applyLevy(database, {
      member,
      eventId: "evt_levy_2",
    });

    expect(outcome).toBe("applied");
    await expect(paymentCountOf(database, member)).resolves.toBe("1");
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
