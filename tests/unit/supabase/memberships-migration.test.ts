import { describe, expect, it } from "vitest";
import {
  type TemporaryDatabase,
  applyRepositoryMigrations,
  databaseBeforeMigration,
  describeConPostgres,
  migratedDatabase,
} from "../../support/postgres";

/**
 * `0050_memberships.sql` contra un Postgres desechable (#451, RF-1 y RF-7 del
 * PRD de E12). Lo que la base afirma sola: el plan y el estado, una membresía
 * por socio, los pagos sin duplicar el mismo cobro de Stripe, el relleno de
 * los socios que ya existían, las cascadas y que sólo el servidor escribe.
 */

const SEEDED_CLUB = "victoria-seadragons";
const MIGRATION_PREFIX = "0050";

type Member = { readonly clubId: string; readonly userId: string };

function seededClubId(database: TemporaryDatabase): Promise<string> {
  return database.query(
    `select id from public.clubs where slug = '${SEEDED_CLUB}'`,
  );
}

function createOtherClub(database: TemporaryDatabase): Promise<string> {
  return database.query(
    `insert into public.clubs (name, slug)
     values ('Otro club', 'otro-club-' || gen_random_uuid())
     returning id`,
  );
}

async function seedMember(
  database: TemporaryDatabase,
  options: { readonly clubId: string; readonly plan?: string | null },
): Promise<Member> {
  const userId = await database.query(
    "insert into auth.users (id) values (gen_random_uuid()) returning id",
  );
  const plan = options.plan ? `'${options.plan}'` : "null";
  await database.query(
    `insert into public.members
       (club_id, user_id, full_name, email, account_status, membership_type)
     values ('${options.clubId}', '${userId}', 'Pablo Player',
             '${userId}@example.test', 'active', ${plan})`,
  );
  return { clubId: options.clubId, userId };
}

async function seededMember(database: TemporaryDatabase): Promise<Member> {
  return seedMember(database, { clubId: await seededClubId(database) });
}

function insertMembershipSql(
  member: Member,
  columns: Readonly<Record<string, string>> = {},
): string {
  const values: Record<string, string> = {
    user_id: `'${member.userId}'`,
    club_id: `'${member.clubId}'`,
    plan: "'Full'",
    status: "'pending'",
    ...columns,
  };
  return `insert into public.memberships (${Object.keys(values).join(", ")})
          values (${Object.values(values).join(", ")})`;
}

function insertPaymentSql(
  member: Member,
  columns: Readonly<Record<string, string>> = {},
): string {
  const values: Record<string, string> = {
    user_id: `'${member.userId}'`,
    club_id: `'${member.clubId}'`,
    stripe_invoice_id: "'in_' || gen_random_uuid()",
    amount_cents: "4500",
    currency: "'aud'",
    description: "'Cuota Full'",
    status: "'paid'",
    paid_at: "now()",
    ...columns,
  };
  return `insert into public.payments (${Object.keys(values).join(", ")})
          values (${Object.values(values).join(", ")})`;
}

function columnsOf(
  database: TemporaryDatabase,
  table: string,
): Promise<string> {
  return database.query(
    `select string_agg(column_name || ':' || data_type, ',' order by column_name)
       from information_schema.columns
      where table_schema = 'public' and table_name = '${table}'`,
  );
}

function asMember(member: Member): string {
  return `set role authenticated;
    set request.jwt.claims = '{"sub":"${member.userId}"}';`;
}

function nonEmptyLines(output: string): readonly string[] {
  return output.split("\n").filter((line) => line.trim() !== "");
}

describeConPostgres("membresías y pagos en la base", () => {
  describe("forma de memberships", () => {
    it("tiene exactamente las columnas de la membresía y ninguna otra de tarjeta", async () => {
      const database = await migratedDatabase();

      await expect(columnsOf(database, "memberships")).resolves.toBe(
        [
          "card_brand:text",
          "card_exp_month:smallint",
          "card_exp_year:smallint",
          "card_last4:text",
          "club_id:uuid",
          "created_at:timestamp with time zone",
          "current_period_end:timestamp with time zone",
          "plan:text",
          "scheduled_at:timestamp with time zone",
          "scheduled_plan:text",
          "status:text",
          "stripe_customer_id:text",
          "stripe_event_at:timestamp with time zone",
          "stripe_subscription_id:text",
          "trial_end:timestamp with time zone",
          "updated_at:timestamp with time zone",
          "user_id:uuid",
          "waived_by:uuid",
          "waived_reason:text",
          "waived_until:timestamp with time zone",
        ].join(","),
      );
    });

    it.each(["Full", "Student", "Casual"])(
      "acepta el plan %s",
      async (plan) => {
        const database = await migratedDatabase();
        const member = await seededMember(database);

        const intento = await database.attempt(
          insertMembershipSql(member, { plan: `'${plan}'` }),
        );

        expect(intento.code, intento.stderr).toBe(0);
      },
    );

    it("rechaza un plan fuera de Full, Student y Casual", async () => {
      const database = await migratedDatabase();
      const member = await seededMember(database);

      const intento = await database.attempt(
        insertMembershipSql(member, { plan: "'Gold'" }),
      );

      expect(intento.code).toBeGreaterThan(0);
      expect(intento.stderr).toMatch(/memberships_plan_check/);
    });

    it.each(["pending", "trialing", "active", "past_due", "cancelled"])(
      "acepta el estado %s",
      async (status) => {
        const database = await migratedDatabase();
        const member = await seededMember(database);

        const intento = await database.attempt(
          insertMembershipSql(member, { status: `'${status}'` }),
        );

        expect(intento.code, intento.stderr).toBe(0);
      },
    );

    it("acepta waived con su motivo", async () => {
      const database = await migratedDatabase();
      const member = await seededMember(database);

      const intento = await database.attempt(
        insertMembershipSql(member, {
          status: "'waived'",
          waived_reason: "'Entrenador'",
        }),
      );

      expect(intento.code, intento.stderr).toBe(0);
    });

    it("rechaza waived sin motivo", async () => {
      const database = await migratedDatabase();
      const member = await seededMember(database);

      const intento = await database.attempt(
        insertMembershipSql(member, { status: "'waived'" }),
      );

      expect(intento.code).toBeGreaterThan(0);
      expect(intento.stderr).toMatch(/memberships_waived_reason_check/);
    });

    it("rechaza un estado fuera de los seis de D1", async () => {
      const database = await migratedDatabase();
      const member = await seededMember(database);

      const intento = await database.attempt(
        insertMembershipSql(member, { status: "'paused'" }),
      );

      expect(intento.code).toBeGreaterThan(0);
      expect(intento.stderr).toMatch(/memberships_status_check/);
    });

    it("rechaza una segunda membresía para el mismo socio", async () => {
      const database = await migratedDatabase();
      const member = await seededMember(database);
      await database.query(insertMembershipSql(member));

      const intento = await database.attempt(insertMembershipSql(member));

      expect(intento.code).toBeGreaterThan(0);
      expect(intento.stderr).toMatch(/memberships_pkey/);
    });

    it("rechaza una membresía cuyo club no es el del socio", async () => {
      const database = await migratedDatabase();
      const member = await seededMember(database);
      const otherClubId = await createOtherClub(database);

      const intento = await database.attempt(
        insertMembershipSql({ ...member, clubId: otherClubId }),
      );

      expect(intento.code).toBeGreaterThan(0);
      expect(intento.stderr).toMatch(/memberships_member_same_club_fkey/);
    });

    it("rechaza unos últimos cuatro dígitos que no son cuatro dígitos", async () => {
      const database = await migratedDatabase();
      const member = await seededMember(database);

      const intento = await database.attempt(
        insertMembershipSql(member, { card_last4: "'4242424242424242'" }),
      );

      expect(intento.code).toBeGreaterThan(0);
      expect(intento.stderr).toMatch(/memberships_card_last4_check/);
    });

    it("si quien eximió se va, la membresía se queda sin su nombre", async () => {
      const database = await migratedDatabase();
      const member = await seededMember(database);
      const admin = await seedMember(database, { clubId: member.clubId });
      await database.query(
        insertMembershipSql(member, {
          status: "'waived'",
          waived_reason: "'Entrenador'",
          waived_by: `'${admin.userId}'`,
        }),
      );

      await database.query(
        `delete from auth.users where id = '${admin.userId}'`,
      );

      await expect(
        database.query(
          `select status || '|' || coalesce(waived_by::text, 'null')
             from public.memberships where user_id = '${member.userId}'`,
        ),
      ).resolves.toBe("waived|null");
    });
  });

  describe("forma de payments y stripe_events", () => {
    it("payments tiene las columnas del historial de cobros", async () => {
      const database = await migratedDatabase();

      await expect(columnsOf(database, "payments")).resolves.toBe(
        [
          "amount_cents:integer",
          "club_id:uuid",
          "created_at:timestamp with time zone",
          "currency:text",
          "description:text",
          "id:uuid",
          "paid_at:timestamp with time zone",
          "status:text",
          "stripe_charge_id:text",
          "stripe_invoice_id:text",
          "user_id:uuid",
        ].join(","),
      );
    });

    it("stripe_events guarda el id del evento, su tipo, cuándo se creó y cuándo se aplicó", async () => {
      const database = await migratedDatabase();

      await expect(columnsOf(database, "stripe_events")).resolves.toBe(
        [
          "created:timestamp with time zone",
          "id:text",
          "processed_at:timestamp with time zone",
          "type:text",
        ].join(","),
      );
    });

    it("rechaza el mismo evento de Stripe dos veces", async () => {
      const database = await migratedDatabase();
      const insert = `insert into public.stripe_events (id, type, created)
                      values ('evt_1', 'invoice.paid', now())`;
      await database.query(insert);

      const intento = await database.attempt(insert);

      expect(intento.code).toBeGreaterThan(0);
      expect(intento.stderr).toMatch(/stripe_events_pkey/);
    });

    it.each(["paid", "failed", "pending"])(
      "acepta un pago %s",
      async (status) => {
        const database = await migratedDatabase();
        const member = await seededMember(database);

        const intento = await database.attempt(
          insertPaymentSql(member, { status: `'${status}'` }),
        );

        expect(intento.code, intento.stderr).toBe(0);
      },
    );

    it("rechaza un estado de pago fuera de paid, failed y pending", async () => {
      const database = await migratedDatabase();
      const member = await seededMember(database);

      const intento = await database.attempt(
        insertPaymentSql(member, { status: "'refunded'" }),
      );

      expect(intento.code).toBeGreaterThan(0);
      expect(intento.stderr).toMatch(/payments_status_check/);
    });

    it("rechaza la misma factura de Stripe dos veces", async () => {
      const database = await migratedDatabase();
      const member = await seededMember(database);
      await database.query(
        insertPaymentSql(member, { stripe_invoice_id: "'in_1'" }),
      );

      const intento = await database.attempt(
        insertPaymentSql(member, { stripe_invoice_id: "'in_1'" }),
      );

      expect(intento.code).toBeGreaterThan(0);
      expect(intento.stderr).toMatch(/payments_stripe_invoice_id_key/);
    });

    it("rechaza el mismo cargo de Stripe dos veces", async () => {
      const database = await migratedDatabase();
      const member = await seededMember(database);
      const charge = {
        stripe_invoice_id: "null",
        stripe_charge_id: "'ch_1'",
      };
      await database.query(insertPaymentSql(member, charge));

      const intento = await database.attempt(insertPaymentSql(member, charge));

      expect(intento.code).toBeGreaterThan(0);
      expect(intento.stderr).toMatch(/payments_stripe_charge_id_key/);
    });

    it("rechaza un pago sin factura ni cargo de Stripe", async () => {
      const database = await migratedDatabase();
      const member = await seededMember(database);

      const intento = await database.attempt(
        insertPaymentSql(member, { stripe_invoice_id: "null" }),
      );

      expect(intento.code).toBeGreaterThan(0);
      expect(intento.stderr).toMatch(/payments_stripe_reference_check/);
    });

    it("rechaza un importe negativo", async () => {
      const database = await migratedDatabase();
      const member = await seededMember(database);

      const intento = await database.attempt(
        insertPaymentSql(member, { amount_cents: "-1" }),
      );

      expect(intento.code).toBeGreaterThan(0);
      expect(intento.stderr).toMatch(/payments_amount_cents_check/);
    });

    it("rechaza una moneda que no viene en minúsculas como la manda Stripe", async () => {
      const database = await migratedDatabase();
      const member = await seededMember(database);

      const intento = await database.attempt(
        insertPaymentSql(member, { currency: "'AUD'" }),
      );

      expect(intento.code).toBeGreaterThan(0);
      expect(intento.stderr).toMatch(/payments_currency_check/);
    });

    it("rechaza un pago cuyo club no es el del socio", async () => {
      const database = await migratedDatabase();
      const member = await seededMember(database);
      const otherClubId = await createOtherClub(database);

      const intento = await database.attempt(
        insertPaymentSql({ ...member, clubId: otherClubId }),
      );

      expect(intento.code).toBeGreaterThan(0);
      expect(intento.stderr).toMatch(/payments_member_same_club_fkey/);
    });
  });

  describe("relleno de los socios que ya existían", () => {
    it("da a cada socio su membresía pending con el plan de membership_type", async () => {
      const database = await databaseBeforeMigration(MIGRATION_PREFIX);
      const clubId = await seededClubId(database);
      const student = await seedMember(database, { clubId, plan: "Student" });
      const withoutPlan = await seedMember(database, { clubId, plan: null });

      const applied = await applyRepositoryMigrations(database);

      expect(applied.code, applied.stderr).toBe(0);
      await expect(
        database.query(
          `select coalesce(plan, 'null') || '|' || status
             from public.memberships
            where user_id in ('${student.userId}', '${withoutPlan.userId}')
            order by user_id = '${withoutPlan.userId}'`,
        ),
      ).resolves.toBe("Student|pending\nnull|pending");
    });

    it("aplicarlo otra vez no duplica ni resetea la membresía", async () => {
      const database = await databaseBeforeMigration(MIGRATION_PREFIX);
      const member = await seedMember(database, {
        clubId: await seededClubId(database),
        plan: "Full",
      });
      await applyRepositoryMigrations(database);
      await database.query(
        `update public.memberships set status = 'active'
          where user_id = '${member.userId}'`,
      );

      const segunda = await applyRepositoryMigrations(database);

      expect(segunda.code, segunda.stderr).toBe(0);
      await expect(
        database.query(
          `select count(*) || '|' || max(status) from public.memberships
            where user_id = '${member.userId}'`,
        ),
      ).resolves.toBe("1|active");
    });
  });

  it("borrar la identidad del socio se lleva su membresía y sus pagos", async () => {
    const database = await migratedDatabase();
    const member = await seededMember(database);
    await database.query(insertMembershipSql(member));
    await database.query(insertPaymentSql(member));

    await database.query(
      `delete from auth.users where id = '${member.userId}'`,
    );

    await expect(
      database.query(
        `select (select count(*) from public.memberships
                  where user_id = '${member.userId}') || '|' ||
                (select count(*) from public.payments
                  where user_id = '${member.userId}')`,
      ),
    ).resolves.toBe("0|0");
  });

  it("es idempotente: aplicada dos veces no falla ni cambia nada", async () => {
    const database = await migratedDatabase();
    const despuesDeLaPrimera = await database.snapshot();

    const segunda = await applyRepositoryMigrations(database);

    expect(segunda.code, segunda.stderr).toBe(0);
    expect(despuesDeLaPrimera).toMatch(/tabla memberships rls=t/);
    expect(despuesDeLaPrimera).toMatch(/tabla payments rls=t/);
    expect(despuesDeLaPrimera).toMatch(/tabla stripe_events rls=t/);
    expect(await database.snapshot()).toBe(despuesDeLaPrimera);
  });

  it("schema-expected.txt declara lo que la migración deja", async () => {
    const database = await migratedDatabase();

    const comprobacion = await database.checkSchema();

    expect(comprobacion.code, comprobacion.stdout + comprobacion.stderr).toBe(
      0,
    );
  });

  describe("privilegios", () => {
    it.each(["memberships", "payments"])(
      "deja a anon sin privilegios y a authenticated sólo con la lectura de %s",
      async (table) => {
        const database = await migratedDatabase();

        const privilegios = await database.query(
          `select grantee || ' ' || string_agg(privilege_type, ',' order by privilege_type)
             from information_schema.role_table_grants
            where table_schema = 'public' and table_name = '${table}'
              and grantee in ('anon', 'authenticated')
            group by grantee order by grantee`,
        );

        expect(privilegios).toBe("authenticated SELECT");
      },
    );

    it("no deja a anon ni a authenticated ningún privilegio sobre stripe_events", async () => {
      const database = await migratedDatabase();

      const privilegios = await database.query(
        `select count(*) from information_schema.role_table_grants
          where table_schema = 'public' and table_name = 'stripe_events'
            and grantee in ('anon', 'authenticated')`,
      );

      expect(privilegios).toBe("0");
    });

    it.each(["memberships", "payments", "stripe_events"])(
      "da a service_role la lectura y la escritura de %s",
      async (table) => {
        const database = await migratedDatabase();

        const privilegios = await database.query(
          `select string_agg(privilege_type, ',' order by privilege_type)
             from information_schema.role_table_grants
            where table_schema = 'public' and table_name = '${table}'
              and grantee = 'service_role'
              and privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE')`,
        );

        expect(privilegios).toBe("DELETE,INSERT,SELECT,UPDATE");
      },
    );

    it("un socio lee sólo su membresía y no puede escribir ninguna", async () => {
      const database = await migratedDatabase();
      const member = await seededMember(database);
      const other = await seededMember(database);
      await database.query(insertMembershipSql(member, { plan: "'Student'" }));
      await database.query(insertMembershipSql(other, { plan: "'Casual'" }));

      const lectura = await database.query(
        `${asMember(member)} select plan from public.memberships`,
      );
      const escrituras = await Promise.all([
        database.attempt(`${asMember(member)} ${insertMembershipSql(other)}`),
        database.attempt(
          `${asMember(member)} update public.memberships set status = 'active'`,
        ),
        database.attempt(`${asMember(member)} delete from public.memberships`),
      ]);

      expect(nonEmptyLines(lectura)).toEqual(["Student"]);
      for (const escritura of escrituras) {
        expect(escritura.code).toBeGreaterThan(0);
        expect(escritura.stderr).toMatch(/permission denied/);
      }
    });

    it("un socio lee sólo sus pagos y no puede escribir ninguno", async () => {
      const database = await migratedDatabase();
      const member = await seededMember(database);
      const other = await seededMember(database);
      await database.query(
        insertPaymentSql(member, { description: "'Propio'" }),
      );
      await database.query(insertPaymentSql(other, { description: "'Ajeno'" }));

      const lectura = await database.query(
        `${asMember(member)} select description from public.payments`,
      );
      const escrituras = await Promise.all([
        database.attempt(`${asMember(member)} ${insertPaymentSql(member)}`),
        database.attempt(
          `${asMember(member)} update public.payments set status = 'failed'`,
        ),
        database.attempt(`${asMember(member)} delete from public.payments`),
      ]);

      expect(nonEmptyLines(lectura)).toEqual(["Propio"]);
      for (const escritura of escrituras) {
        expect(escritura.code).toBeGreaterThan(0);
        expect(escritura.stderr).toMatch(/permission denied/);
      }
    });

    it.each(["anon", "authenticated"])(
      "%s no lee stripe_events",
      async (role) => {
        const database = await migratedDatabase();
        await database.query(
          `insert into public.stripe_events (id, type, created)
           values ('evt_1', 'invoice.paid', now())`,
        );

        const lectura = await database.attempt(
          `set role ${role}; select count(*) from public.stripe_events`,
        );

        expect(lectura.code).toBeGreaterThan(0);
        expect(lectura.stderr).toMatch(/permission denied/);
      },
    );

    it.each(["memberships", "payments"])("anon no lee %s", async (table) => {
      const database = await migratedDatabase();

      const lectura = await database.attempt(
        `set role anon; select count(*) from public.${table}`,
      );

      expect(lectura.code).toBeGreaterThan(0);
      expect(lectura.stderr).toMatch(/permission denied/);
    });
  });
});
