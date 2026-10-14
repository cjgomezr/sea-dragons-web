import { expect, it } from "vitest";
import {
  type TemporaryDatabase,
  applyRepositoryMigrations,
  databaseBeforeMigration,
  describeConPostgres,
  migratedDatabase,
} from "../../support/postgres";

/**
 * `0066_payment_charge_details.sql` contra un Postgres desechable (#629, RF-3
 * y D4 del PRD de E23). Cada pago guarda con qué tarjeta se cobró y por qué
 * falló, si falló. Las tres funciones que apuntan pagos los reciben en el
 * `jsonb` del pago, y una llamada que no los manda sigue funcionando. Los
 * pagos anteriores no se rellenan.
 */

const SEEDED_CLUB = "victoria-seadragons";
const MIGRATION_PREFIX = "0066";
const INVOICE_ID = "in_TestSeadragons";
const PACK_PAYMENT_INTENT_ID = "pi_TestSeadragonsPack";
const LEVY_PAYMENT_INTENT_ID = "pi_TestSeadragonsLevy";
const DECLINED = "Your card was declined.";

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
     values ('${clubId}', '${userId}', 'Pablo Player',
             '${userId}@example.test', 'active')`,
  );
  await database.query(
    `insert into public.memberships (user_id, club_id, plan, status)
     values ('${userId}', '${clubId}', 'Full', 'active')`,
  );
  return { clubId, userId };
}

function invoicePayment(
  change: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    stripe_invoice_id: INVOICE_ID,
    amount_cents: 4500,
    currency: "aud",
    description: "Full membership",
    status: "paid",
    paid_at: "2026-10-01T10:00:00.000Z",
    ...change,
  };
}

function applyInvoice(
  database: TemporaryDatabase,
  request: {
    readonly member: Member;
    readonly eventId: string;
    readonly payment: Record<string, unknown>;
  },
): Promise<string> {
  return database.query(
    `select public.apply_stripe_event(
       '${request.eventId}', 'invoice.paid', '2026-10-01T10:00:00Z',
       '${request.member.userId}', '${request.member.clubId}', null,
       '${JSON.stringify(request.payment)}'::jsonb)`,
  );
}

function chargePayment(
  paymentIntentId: string,
  change: Record<string, unknown> = {},
): string {
  return JSON.stringify({
    stripe_charge_id: paymentIntentId,
    amount_cents: 2500,
    currency: "aud",
    description: "Casual session pack (5 sessions)",
    paid_at: "2026-10-07T09:00:00.000Z",
    ...change,
  });
}

function applyPack(
  database: TemporaryDatabase,
  member: Member,
  change: Record<string, unknown>,
): Promise<string> {
  return database.query(
    `select public.apply_session_pack_payment(
       'evt_pack_1', 'checkout.session.completed', '2026-10-07T09:00:00Z',
       '${member.userId}', '${member.clubId}',
       '${chargePayment(PACK_PAYMENT_INTENT_ID, change)}'::jsonb, 5)`,
  );
}

function applyLevy(
  database: TemporaryDatabase,
  member: Member,
  change: Record<string, unknown>,
): Promise<string> {
  const payment = chargePayment(LEVY_PAYMENT_INTENT_ID, {
    stripe_product_id: "prod_TestNationals",
    ...change,
  });
  return database.query(
    `select public.apply_levy_payment(
       'evt_levy_1', 'checkout.session.completed', '2026-10-07T09:00:00Z',
       '${member.userId}', '${member.clubId}', '${payment}'::jsonb)`,
  );
}

/** Estado, marca, dígitos y motivo del único pago del socio; `-` por nulo. */
function chargeOf(
  database: TemporaryDatabase,
  member: Member,
): Promise<string> {
  return database.query(
    `select concat_ws('|', status, coalesce(card_brand, '-'),
                      coalesce(card_last4, '-'),
                      coalesce(failure_reason, '-'))
       from public.payments where user_id = '${member.userId}'`,
  );
}

describeConPostgres("0066_payment_charge_details", () => {
  it("añade la marca, los cuatro dígitos y el motivo como texto nulable", async () => {
    const database = await migratedDatabase();

    const columns = await database.query(
      `select string_agg(column_name || ':' || data_type || ':' || is_nullable,
                         ',' order by column_name)
         from information_schema.columns
        where table_schema = 'public' and table_name = 'payments'
          and column_name in ('card_brand', 'card_last4', 'failure_reason')`,
    );

    expect(columns).toBe(
      "card_brand:text:YES,card_last4:text:YES,failure_reason:text:YES",
    );
  });

  it("deja como estaban los pagos que ya había, sin tarjeta ni motivo", async () => {
    const database = await databaseBeforeMigration(MIGRATION_PREFIX);
    const member = await seedMember(database);
    await database.query(
      `select public.apply_stripe_event(
         'evt_antes', 'invoice.paid', '2026-09-01T10:00:00Z',
         '${member.userId}', '${member.clubId}', null,
         '${JSON.stringify(invoicePayment())}'::jsonb)`,
    );

    const applied = await applyRepositoryMigrations(database);

    expect(applied.code, applied.stderr).toBe(0);
    await expect(chargeOf(database, member)).resolves.toBe("paid|-|-|-");
  });

  it("rechaza unos dígitos de tarjeta que no son cuatro cifras", async () => {
    const database = await migratedDatabase();
    const member = await seedMember(database);
    await applyInvoice(database, {
      member,
      eventId: "evt_1",
      payment: invoicePayment(),
    });

    const rejected = await database.attempt(
      `update public.payments set card_last4 = '42a4'
        where user_id = '${member.userId}'`,
    );

    expect(rejected.code).not.toBe(0);
    expect(rejected.stderr).toContain("payments_card_last4_check");
  });

  it("apunta la tarjeta y el motivo de una cuota fallida", async () => {
    const database = await migratedDatabase();
    const member = await seedMember(database);

    await applyInvoice(database, {
      member,
      eventId: "evt_failed",
      payment: invoicePayment({
        status: "failed",
        paid_at: null,
        card_brand: "visa",
        card_last4: "4242",
        failure_reason: DECLINED,
      }),
    });

    await expect(chargeOf(database, member)).resolves.toBe(
      `failed|visa|4242|${DECLINED}`,
    );
  });

  it("al cobrarse en un reintento queda pagada, con su tarjeta y sin motivo", async () => {
    const database = await migratedDatabase();
    const member = await seedMember(database);
    await applyInvoice(database, {
      member,
      eventId: "evt_failed",
      payment: invoicePayment({
        status: "failed",
        paid_at: null,
        card_brand: "visa",
        card_last4: "4242",
        failure_reason: DECLINED,
      }),
    });

    await applyInvoice(database, {
      member,
      eventId: "evt_paid",
      payment: invoicePayment({
        card_brand: "mastercard",
        card_last4: "4444",
        failure_reason: null,
      }),
    });

    await expect(chargeOf(database, member)).resolves.toBe(
      "paid|mastercard|4444|-",
    );
  });

  it("sigue apuntando una cuota que no manda tarjeta ni motivo", async () => {
    const database = await migratedDatabase();
    const member = await seedMember(database);

    const outcome = await applyInvoice(database, {
      member,
      eventId: "evt_1",
      payment: invoicePayment(),
    });

    expect(outcome).toBe("applied");
    await expect(chargeOf(database, member)).resolves.toBe("paid|-|-|-");
  });

  it("el mismo evento repetido no cambia la tarjeta guardada", async () => {
    const database = await migratedDatabase();
    const member = await seedMember(database);
    const failed = invoicePayment({
      status: "failed",
      paid_at: null,
      card_brand: "visa",
      card_last4: "4242",
      failure_reason: DECLINED,
    });
    await applyInvoice(database, {
      member,
      eventId: "evt_1",
      payment: failed,
    });

    const outcome = await applyInvoice(database, {
      member,
      eventId: "evt_1",
      payment: { ...failed, card_last4: "0005", failure_reason: null },
    });

    expect(outcome).toBe("duplicate");
    await expect(chargeOf(database, member)).resolves.toBe(
      `failed|visa|4242|${DECLINED}`,
    );
  });

  it("apunta la tarjeta del pago de un pack", async () => {
    const database = await migratedDatabase();
    const member = await seedMember(database);

    await applyPack(database, member, {
      card_brand: "amex",
      card_last4: "0005",
    });

    await expect(chargeOf(database, member)).resolves.toBe("paid|amex|0005|-");
  });

  it("apunta la tarjeta del pago de un levy", async () => {
    const database = await migratedDatabase();
    const member = await seedMember(database);

    await applyLevy(database, member, {
      card_brand: "visa",
      card_last4: "4242",
    });

    await expect(chargeOf(database, member)).resolves.toBe("paid|visa|4242|-");
  });

  it("un pack o un levy sin tarjeta se apuntan igual", async () => {
    const database = await migratedDatabase();
    const member = await seedMember(database);

    await applyPack(database, member, {});
    await applyLevy(database, member, {});

    await expect(
      database.query(
        `select count(*) from public.payments
          where user_id = '${member.userId}'
            and card_brand is null and card_last4 is null`,
      ),
    ).resolves.toBe("2");
  });

  it("no cambia las políticas de payments: un socio sólo lee los suyos", async () => {
    const database = await migratedDatabase();

    const policies = await database.query(
      `select string_agg(policyname || ':' || cmd, ',' order by policyname)
         from pg_policies
        where schemaname = 'public' and tablename = 'payments'`,
    );

    expect(policies).toBe("payments_select_own:SELECT");
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
