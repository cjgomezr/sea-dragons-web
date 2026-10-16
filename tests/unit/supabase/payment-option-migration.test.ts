import { expect, it } from "vitest";
import {
  type TemporaryDatabase,
  applyRepositoryMigrations,
  databaseBeforeMigration,
  describeConPostgres,
  migratedDatabase,
} from "../../support/postgres";

/**
 * `0070_payment_option.sql` contra un Postgres desechable (#637, RF-11 y D13
 * del PRD de E23). Un extra puede pedir una opción al comprarlo: el pago la
 * guarda, `apply_levy_payment` la recibe en el `jsonb` del pago y un pago sin
 * opción, o anterior, la deja nula.
 */

const SEEDED_CLUB = "victoria-seadragons";
const MIGRATION_PREFIX = "0070";
const NULL_MARK = "<null>";

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
    stripe_charge_id: "pi_TestSeadragonsJersey",
    stripe_product_id: "prod_TestJersey",
    amount_cents: 27000,
    currency: "aud",
    description: "2026 club jersey",
    paid_at: "2026-10-16T09:00:00.000Z",
    quantity: 2,
    ...change,
  });
  return database.query(
    `select public.apply_levy_payment(
       'evt_jersey_option', 'checkout.session.completed',
       '2026-10-16T09:00:00Z', '${member.userId}', '${member.clubId}',
       '${payment}'::jsonb)`,
  );
}

function optionOf(
  database: TemporaryDatabase,
  member: Member,
): Promise<string> {
  return database.query(
    `select coalesce(option, '${NULL_MARK}') from public.payments
      where user_id = '${member.userId}'`,
  );
}

describeConPostgres("0070_payment_option", () => {
  it("apunta la opción que el socio eligió", async () => {
    const database = await migratedDatabase();
    const member = await seedMember(database);

    await applyLevy(database, member, { option: "M" });

    await expect(optionOf(database, member)).resolves.toBe("M");
  });

  it("deja la opción nula si el pago no la trae", async () => {
    const database = await migratedDatabase();
    const member = await seedMember(database);

    await applyLevy(database, member);

    await expect(optionOf(database, member)).resolves.toBe(NULL_MARK);
  });

  it("deja nula la opción de un pago anterior", async () => {
    const database = await databaseBeforeMigration(MIGRATION_PREFIX);
    const member = await seedMember(database);
    await applyLevy(database, member);

    const applied = await applyRepositoryMigrations(database);

    expect(applied.code, applied.stderr).toBe(0);
    await expect(optionOf(database, member)).resolves.toBe(NULL_MARK);
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
