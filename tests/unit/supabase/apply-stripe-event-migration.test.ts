import { expect, it } from "vitest";
import {
  type TemporaryDatabase,
  describeConPostgres,
  migratedDatabase,
} from "../../support/postgres";

/**
 * `0051_apply_stripe_event.sql` contra un Postgres desechable (#452, RF-7 y
 * RF-8 del PRD de E12). El evento, la membresía y el pago se escriben juntos
 * o nada; el id del evento entra primero y un repetido no escribe; un evento
 * más viejo que el último aplicado no retrocede la membresía.
 */

const SEEDED_CLUB = "victoria-seadragons";
const FIRST_AT = "2026-10-01T10:00:00Z";
const LATER_AT = "2026-10-01T11:00:00Z";

type Member = { readonly clubId: string; readonly userId: string };

type StripeEventCall = {
  readonly id: string;
  readonly created?: string;
  readonly membership?: Record<string, unknown> | null;
  readonly payment?: Record<string, unknown> | null;
};

async function seedMemberWithMembership(
  database: TemporaryDatabase,
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
     values ('${clubId}', '${userId}', 'Pablo Player',
             '${userId}@example.test', 'active')`,
  );
  await database.query(
    `insert into public.memberships (user_id, club_id, plan, status)
     values ('${userId}', '${clubId}', 'Full', 'pending')`,
  );
  return { clubId, userId };
}

function jsonOrNull(value: Record<string, unknown> | null | undefined): string {
  return value ? `'${JSON.stringify(value)}'::jsonb` : "null";
}

function applyStripeEvent(
  database: TemporaryDatabase,
  member: Member,
  call: StripeEventCall,
): Promise<string> {
  return database.query(
    `select public.apply_stripe_event(
       '${call.id}', 'customer.subscription.updated',
       '${call.created ?? FIRST_AT}'::timestamptz,
       '${member.userId}', '${member.clubId}',
       ${jsonOrNull(call.membership)}, ${jsonOrNull(call.payment)})`,
  );
}

function readMembership(
  database: TemporaryDatabase,
  member: Member,
  columns: string,
): Promise<string> {
  return database.query(
    `select concat_ws('|', ${columns}) from public.memberships
      where user_id = '${member.userId}'`,
  );
}

function paidInvoice(
  change: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    stripe_invoice_id: "in_cuota_octubre",
    amount_cents: 4500,
    currency: "aud",
    description: "Cuota Full",
    status: "paid",
    paid_at: LATER_AT,
    ...change,
  };
}

describeConPostgres("aplicar un evento de Stripe en la base", () => {
  it("guarda el id del evento y aplica los cambios de la membresía", async () => {
    const database = await migratedDatabase();
    const member = await seedMemberWithMembership(database);

    const outcome = await applyStripeEvent(database, member, {
      id: "evt_1",
      membership: {
        status: "trialing",
        stripe_customer_id: "cus_1",
        stripe_subscription_id: "sub_1",
        trial_end: LATER_AT,
        card_brand: "visa",
        card_last4: "4242",
        card_exp_month: 12,
        card_exp_year: 2030,
        stripe_event_at: FIRST_AT,
      },
    });

    expect(outcome).toBe("applied");
    await expect(
      readMembership(
        database,
        member,
        "status, stripe_customer_id, stripe_subscription_id, card_brand, card_last4, card_exp_month, card_exp_year, trial_end is not null",
      ),
    ).resolves.toBe("trialing|cus_1|sub_1|visa|4242|12|2030|t");
    await expect(
      database.query(
        "select type from public.stripe_events where id = 'evt_1'",
      ),
    ).resolves.toBe("customer.subscription.updated");
  });

  it("no toca las columnas que el evento no trae", async () => {
    const database = await migratedDatabase();
    const member = await seedMemberWithMembership(database);
    await applyStripeEvent(database, member, {
      id: "evt_1",
      membership: { stripe_customer_id: "cus_1", plan: "Student" },
    });

    await applyStripeEvent(database, member, {
      id: "evt_2",
      membership: { stripe_subscription_id: "sub_1" },
    });

    await expect(
      readMembership(
        database,
        member,
        "plan, stripe_customer_id, stripe_subscription_id",
      ),
    ).resolves.toBe("Student|cus_1|sub_1");
  });

  it("deja la suscripción vacía cuando el evento la trae nula", async () => {
    const database = await migratedDatabase();
    const member = await seedMemberWithMembership(database);
    await applyStripeEvent(database, member, {
      id: "evt_1",
      membership: { stripe_subscription_id: "sub_1" },
    });

    await applyStripeEvent(database, member, {
      id: "evt_2",
      membership: { status: "cancelled", stripe_subscription_id: null },
    });

    await expect(
      readMembership(
        database,
        member,
        "status, stripe_subscription_id is null",
      ),
    ).resolves.toBe("cancelled|t");
  });

  it("un evento repetido responde duplicate y no escribe nada", async () => {
    const database = await migratedDatabase();
    const member = await seedMemberWithMembership(database);
    await applyStripeEvent(database, member, {
      id: "evt_1",
      membership: { status: "trialing" },
    });
    await applyStripeEvent(database, member, {
      id: "evt_2",
      created: LATER_AT,
      membership: { status: "active" },
    });

    const outcome = await applyStripeEvent(database, member, {
      id: "evt_1",
      membership: { status: "trialing" },
      payment: paidInvoice(),
    });

    expect(outcome).toBe("duplicate");
    await expect(readMembership(database, member, "status")).resolves.toBe(
      "active",
    );
    await expect(
      database.query("select count(*) from public.payments"),
    ).resolves.toBe("0");
  });

  it("un evento más viejo que el último aplicado no retrocede la membresía, pero su pago entra", async () => {
    const database = await migratedDatabase();
    const member = await seedMemberWithMembership(database);
    await applyStripeEvent(database, member, {
      id: "evt_nuevo",
      created: LATER_AT,
      membership: { status: "cancelled", stripe_event_at: LATER_AT },
    });

    await applyStripeEvent(database, member, {
      id: "evt_viejo",
      created: FIRST_AT,
      membership: { status: "active", stripe_event_at: FIRST_AT },
      payment: paidInvoice(),
    });

    await expect(readMembership(database, member, "status")).resolves.toBe(
      "cancelled",
    );
    await expect(
      database.query("select count(*) from public.payments"),
    ).resolves.toBe("1");
  });

  it("no pisa una exención vigente aunque el evento traiga estado", async () => {
    const database = await migratedDatabase();
    const member = await seedMemberWithMembership(database);
    await database.query(
      `update public.memberships
          set status = 'waived', waived_reason = 'Entrenador'
        where user_id = '${member.userId}'`,
    );

    await applyStripeEvent(database, member, {
      id: "evt_1",
      membership: { status: "past_due", stripe_subscription_id: "sub_1" },
    });

    await expect(
      readMembership(database, member, "status, stripe_subscription_id"),
    ).resolves.toBe("waived|sub_1");
  });

  it("con la exención vencida, el estado vuelve a seguir al evento", async () => {
    const database = await migratedDatabase();
    const member = await seedMemberWithMembership(database);
    await database.query(
      `update public.memberships
          set status = 'waived', waived_reason = 'Entrenador',
              waived_until = now() - interval '1 day'
        where user_id = '${member.userId}'`,
    );

    await applyStripeEvent(database, member, {
      id: "evt_1",
      membership: { status: "active" },
    });

    await expect(readMembership(database, member, "status")).resolves.toBe(
      "active",
    );
  });

  it("guarda el pago con el socio y el club de la membresía", async () => {
    const database = await migratedDatabase();
    const member = await seedMemberWithMembership(database);

    await applyStripeEvent(database, member, {
      id: "evt_1",
      payment: paidInvoice(),
    });

    await expect(
      database.query(
        `select concat_ws('|', user_id, club_id, amount_cents, currency,
                          description, status, paid_at is not null)
           from public.payments where stripe_invoice_id = 'in_cuota_octubre'`,
      ),
    ).resolves.toBe(
      `${member.userId}|${member.clubId}|4500|aud|Cuota Full|paid|t`,
    );
  });

  it("una factura que falla y luego se paga queda pagada en una sola fila", async () => {
    const database = await migratedDatabase();
    const member = await seedMemberWithMembership(database);
    await applyStripeEvent(database, member, {
      id: "evt_fallo",
      payment: paidInvoice({ status: "failed", paid_at: null }),
    });

    await applyStripeEvent(database, member, {
      id: "evt_pago",
      payment: paidInvoice(),
    });

    await expect(
      database.query("select string_agg(status, ',') from public.payments"),
    ).resolves.toBe("paid");
  });

  it("un fallo que llega después del pago no lo deshace", async () => {
    const database = await migratedDatabase();
    const member = await seedMemberWithMembership(database);
    await applyStripeEvent(database, member, {
      id: "evt_pago",
      payment: paidInvoice(),
    });

    await applyStripeEvent(database, member, {
      id: "evt_fallo",
      payment: paidInvoice({ status: "failed", paid_at: null }),
    });

    await expect(
      database.query("select string_agg(status, ',') from public.payments"),
    ).resolves.toBe("paid");
  });

  it("si algo falla no escribe nada, ni siquiera el id del evento", async () => {
    const database = await migratedDatabase();
    const member = await seedMemberWithMembership(database);

    await expect(
      applyStripeEvent(database, member, {
        id: "evt_roto",
        membership: { status: "trialing" },
        payment: paidInvoice({ currency: "AUD" }),
      }),
    ).rejects.toThrow();

    await expect(
      database.query("select count(*) from public.stripe_events"),
    ).resolves.toBe("0");
    await expect(readMembership(database, member, "status")).resolves.toBe(
      "pending",
    );
  });

  it("sólo la puede llamar el servidor", async () => {
    const database = await migratedDatabase();

    await expect(
      database.query(
        `select string_agg(grantee, ',' order by grantee)
           from information_schema.routine_privileges
          where routine_name = 'apply_stripe_event'
            and privilege_type = 'EXECUTE'`,
      ),
    ).resolves.toBe("postgres,service_role");
  });
});
