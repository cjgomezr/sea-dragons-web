import { expect, it } from "vitest";
import {
  type TemporaryDatabase,
  applyRepositoryMigrations,
  databaseBeforeMigration,
  describeConPostgres,
  migratedDatabase,
} from "../../support/postgres";

/**
 * `0067_levy_quantity.sql` contra un Postgres desechable (#632, RF-6 y D2 del
 * PRD de E23). Un extra se compra en varias unidades: el pago guarda cuántas,
 * `apply_levy_payment` las recibe en el `jsonb` del pago y un pago anterior
 * cuenta como una.
 */

const SEEDED_CLUB = "victoria-seadragons";
const MIGRATION_PREFIX = "0067";
const LEVY_PAYMENT_INTENT_ID = "pi_TestSeadragonsJersey";

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
     values ('${clubId}', '${userId}', 'Juana Jersey',
             '${userId}@example.test', 'active')`,
  );
  return { clubId, userId };
}

function applyLevy(
  database: TemporaryDatabase,
  member: Member,
  change: Record<string, unknown> = {},
): Promise<string> {
  const payment = JSON.stringify({
    stripe_charge_id: LEVY_PAYMENT_INTENT_ID,
    stripe_product_id: "prod_TestJersey",
    amount_cents: 13500,
    currency: "aud",
    description: "2026 club jersey",
    paid_at: "2026-10-15T09:00:00.000Z",
    ...change,
  });
  return database.query(
    `select public.apply_levy_payment(
       'evt_jersey_1', 'checkout.session.completed', '2026-10-15T09:00:00Z',
       '${member.userId}', '${member.clubId}', '${payment}'::jsonb)`,
  );
}

function quantityOf(
  database: TemporaryDatabase,
  member: Member,
): Promise<string> {
  return database.query(
    `select quantity from public.payments where user_id = '${member.userId}'`,
  );
}

describeConPostgres("0067_levy_quantity", () => {
  it("apunta las unidades y el importe total de un extra de varias", async () => {
    const database = await migratedDatabase();
    const member = await seedMember(database);

    await applyLevy(database, member, { quantity: 3 });

    await expect(
      database.query(
        `select quantity || '|' || amount_cents from public.payments
          where user_id = '${member.userId}'`,
      ),
    ).resolves.toBe("3|13500");
  });

  it("apunta una unidad si el pago no dice cuántas", async () => {
    const database = await migratedDatabase();
    const member = await seedMember(database);

    await applyLevy(database, member);

    await expect(quantityOf(database, member)).resolves.toBe("1");
  });

  it("cuenta como una unidad un pago de levy anterior", async () => {
    const database = await databaseBeforeMigration(MIGRATION_PREFIX);
    const member = await seedMember(database);
    await applyLevy(database, member);

    const applied = await applyRepositoryMigrations(database);

    expect(applied.code, applied.stderr).toBe(0);
    await expect(quantityOf(database, member)).resolves.toBe("1");
  });

  it("rechaza un pago de cero unidades", async () => {
    const database = await migratedDatabase();
    const member = await seedMember(database);

    await expect(applyLevy(database, member, { quantity: 0 })).rejects.toThrow(
      /payments_quantity_check/,
    );
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
