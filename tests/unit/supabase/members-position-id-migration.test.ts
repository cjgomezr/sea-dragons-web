import { expect, it } from "vitest";
import {
  type TemporaryDatabase,
  describeConPostgres,
  migratedDatabase,
} from "../../support/postgres";

/**
 * `0026_members_position_id.sql` contra un Postgres desechable (#299). Desde
 * aquí la aplicación escribe `members.position_id` y no la grafía de texto. El
 * trigger de `0025` resolvía el texto a la referencia en cada alta, así que un
 * alta sin texto dejaba la referencia en blanco: la posición elegida se
 * perdía en silencio.
 */

const SEEDED_CLUB = "victoria-seadragons";

function seededPositionId(
  database: TemporaryDatabase,
  englishName: string,
): Promise<string> {
  return database.query(
    `select n.position_id
       from public.club_position_names n
       join public.clubs c on c.id = n.club_id
      where c.slug = '${SEEDED_CLUB}' and n.locale = 'en'
        and n.name = '${englishName}'`,
  );
}

/** Da de alta un miembro del club sembrado con `position_id` (una expresión
 * SQL) y sin texto de posición, como lo hace la aplicación desde #299. */
async function insertMemberWithPositionId(
  database: TemporaryDatabase,
  positionId: string,
): Promise<string> {
  const userId = await database.query(
    "insert into auth.users (id) values (gen_random_uuid()) returning id",
  );
  await database.query(
    `insert into public.members (club_id, user_id, full_name, email, position_id)
     select id, '${userId}', 'Nerea Silva', '${userId}@example.test', ${positionId}
       from public.clubs where slug = '${SEEDED_CLUB}'`,
  );
  return userId;
}

function memberPositionId(
  database: TemporaryDatabase,
  userId: string,
): Promise<string> {
  return database.query(
    `select coalesce(position_id::text, 'ninguna')
       from public.members where user_id = '${userId}'`,
  );
}

describeConPostgres("la posición que escribe la aplicación", () => {
  it("se conserva en un alta que no trae el texto", async () => {
    const database = await migratedDatabase();
    const forward = await seededPositionId(database, "Forward");

    const userId = await insertMemberWithPositionId(database, `'${forward}'`);

    expect(await memberPositionId(database, userId)).toBe(forward);
  });

  it("se conserva al cambiarla por su referencia", async () => {
    const database = await migratedDatabase();
    const forward = await seededPositionId(database, "Forward");
    const defender = await seededPositionId(database, "Defender");
    const userId = await insertMemberWithPositionId(database, `'${forward}'`);

    await database.query(
      `update public.members set position_id = '${defender}'
        where user_id = '${userId}'`,
    );

    expect(await memberPositionId(database, userId)).toBe(defender);
  });

  it("queda vacía en un alta sin ninguna de las dos", async () => {
    const database = await migratedDatabase();

    const userId = await insertMemberWithPositionId(database, "null");

    expect(await memberPositionId(database, userId)).toBe("ninguna");
  });
});
