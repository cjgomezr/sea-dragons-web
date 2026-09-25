import { expect, it } from "vitest";
import {
  type TemporaryDatabase,
  describeConPostgres,
  migratedDatabase,
} from "../../support/postgres";

/**
 * `0027_manage_club_positions.sql` contra un Postgres desechable (#300, RF-7
 * del PRD de E18a). El Admin crea, renombra, reordena, archiva y reactiva las
 * posiciones del club. Cada cambio toca varias filas (la posición y sus
 * nombres, o el orden de todas), así que va en una función y no en varias
 * escrituras sueltas que podrían quedarse a medias.
 */

const SEEDED_CLUB = "victoria-seadragons";

type Outcome = Record<string, unknown>;

function clubIdOf(database: TemporaryDatabase, slug: string): Promise<string> {
  return database.query(`select id from public.clubs where slug = '${slug}'`);
}

function seededClubId(database: TemporaryDatabase): Promise<string> {
  return clubIdOf(database, SEEDED_CLUB);
}

function positionIdNamed(
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

function sqlText(value: string | null): string {
  return value === null ? "null" : `'${value}'`;
}

async function callFunction(
  database: TemporaryDatabase,
  call: string,
): Promise<Outcome> {
  return JSON.parse(await database.query(`select public.${call}`)) as Outcome;
}

function createPosition(
  database: TemporaryDatabase,
  clubId: string,
  names: { readonly en: string | null; readonly es: string | null },
): Promise<Outcome> {
  return callFunction(
    database,
    `create_club_position('${clubId}', ${sqlText(names.en)}, ${sqlText(names.es)})`,
  );
}

function renamePosition(
  database: TemporaryDatabase,
  target: { readonly clubId: string; readonly positionId: string },
  names: { readonly en: string | null; readonly es: string | null },
): Promise<Outcome> {
  return callFunction(
    database,
    `rename_club_position('${target.clubId}', '${target.positionId}', ${sqlText(names.en)}, ${sqlText(names.es)})`,
  );
}

function reorderPositions(
  database: TemporaryDatabase,
  clubId: string,
  orderedIds: readonly string[],
): Promise<Outcome> {
  const ids = orderedIds.map((id) => `'${id}'`).join(", ");
  return callFunction(
    database,
    `reorder_club_positions('${clubId}', array[${ids}]::uuid[])`,
  );
}

function setArchived(
  database: TemporaryDatabase,
  target: { readonly clubId: string; readonly positionId: string },
  isArchived: boolean,
): Promise<Outcome> {
  return callFunction(
    database,
    `set_club_position_archived('${target.clubId}', '${target.positionId}', ${isArchived})`,
  );
}

/** Los nombres de las activas del club sembrado, en su orden, como
 * `en|es` con `-` donde falta uno. */
async function activePositions(database: TemporaryDatabase): Promise<string[]> {
  const rows = await database.query(
    `select coalesce(en.name, '-') || '|' || coalesce(es.name, '-')
       from public.club_positions p
       join public.clubs c on c.id = p.club_id
       left join public.club_position_names en
         on en.position_id = p.id and en.locale = 'en'
       left join public.club_position_names es
         on es.position_id = p.id and es.locale = 'es'
      where c.slug = '${SEEDED_CLUB}' and p.archived_at is null
      order by p.sort_order, p.created_at, p.id`,
  );
  return rows.split("\n");
}

async function insertMemberWithPosition(
  database: TemporaryDatabase,
  positionId: string,
): Promise<string> {
  const userId = await database.query(
    "insert into auth.users (id) values (gen_random_uuid()) returning id",
  );
  await database.query(
    `insert into public.members (club_id, user_id, full_name, email, position_id)
     select id, '${userId}', 'Nerea Silva', '${userId}@example.test', '${positionId}'
       from public.clubs where slug = '${SEEDED_CLUB}'`,
  );
  return userId;
}

function memberPositionId(
  database: TemporaryDatabase,
  userId: string,
): Promise<string> {
  return database.query(
    `select position_id from public.members where user_id = '${userId}'`,
  );
}

describeConPostgres("crear una posición", () => {
  it("la pone al final de las activas, con sus dos nombres", async () => {
    const database = await migratedDatabase();
    const clubId = await seededClubId(database);

    const outcome = await createPosition(database, clubId, {
      en: "Centre",
      es: "Centro",
    });

    expect(outcome).toMatchObject({ outcome: "created" });
    expect(await activePositions(database)).toEqual([
      "Goalkeeper|Portería",
      "Defender|Defensa",
      "Forward|Ataque",
      "Centre|Centro",
    ]);
  });

  it("guarda sólo el nombre que se dio", async () => {
    const database = await migratedDatabase();
    const clubId = await seededClubId(database);

    await createPosition(database, clubId, { en: null, es: "Centro" });

    expect((await activePositions(database)).at(-1)).toBe("-|Centro");
  });

  it("rechaza un nombre repetido en el mismo idioma sin crear nada", async () => {
    const database = await migratedDatabase();
    const clubId = await seededClubId(database);

    const outcome = await createPosition(database, clubId, {
      en: "Centre",
      es: "  defensa ",
    });

    expect(outcome).toEqual({ outcome: "name_taken", locale: "es" });
    expect(await activePositions(database)).toHaveLength(3);
  });

  it("no acepta una posición sin ningún nombre", async () => {
    const database = await migratedDatabase();
    const clubId = await seededClubId(database);

    await expect(
      createPosition(database, clubId, { en: null, es: null }),
    ).rejects.toThrow(/nombre/);
  });
});

describeConPostgres("renombrar una posición", () => {
  it("cambia el nombre y quien la tenía la sigue teniendo", async () => {
    const database = await migratedDatabase();
    const clubId = await seededClubId(database);
    const forward = await positionIdNamed(database, "Forward");
    const userId = await insertMemberWithPosition(database, forward);

    const outcome = await renamePosition(
      database,
      { clubId, positionId: forward },
      { en: "Striker", es: "Delantera" },
    );

    expect(outcome).toEqual({ outcome: "renamed" });
    expect((await activePositions(database)).at(-1)).toBe("Striker|Delantera");
    expect(await memberPositionId(database, userId)).toBe(forward);
  });

  it("quita el nombre del idioma que llega vacío", async () => {
    const database = await migratedDatabase();
    const clubId = await seededClubId(database);
    const forward = await positionIdNamed(database, "Forward");

    await renamePosition(
      database,
      { clubId, positionId: forward },
      { en: "Forward", es: null },
    );

    expect((await activePositions(database)).at(-1)).toBe("Forward|-");
  });

  it("deja cambiar sólo las mayúsculas de su propio nombre", async () => {
    const database = await migratedDatabase();
    const clubId = await seededClubId(database);
    const forward = await positionIdNamed(database, "Forward");

    const outcome = await renamePosition(
      database,
      { clubId, positionId: forward },
      { en: "FORWARD", es: "Ataque" },
    );

    expect(outcome).toEqual({ outcome: "renamed" });
  });

  it("rechaza el nombre de otra posición sin tocar nada", async () => {
    const database = await migratedDatabase();
    const clubId = await seededClubId(database);
    const forward = await positionIdNamed(database, "Forward");

    const outcome = await renamePosition(
      database,
      { clubId, positionId: forward },
      { en: "goalkeeper", es: "Ataque" },
    );

    expect(outcome).toEqual({ outcome: "name_taken", locale: "en" });
    expect((await activePositions(database)).at(-1)).toBe("Forward|Ataque");
  });

  it("no encuentra la posición de otro club", async () => {
    const database = await migratedDatabase();
    const otherClubId = await database.query(
      `insert into public.clubs (slug, name) values ('otro-club', 'Otro Club')
       returning id`,
    );
    const forward = await positionIdNamed(database, "Forward");

    const outcome = await renamePosition(
      database,
      { clubId: otherClubId, positionId: forward },
      { en: "Striker", es: null },
    );

    expect(outcome).toEqual({ outcome: "not_found" });
    expect((await activePositions(database)).at(-1)).toBe("Forward|Ataque");
  });
});

describeConPostgres("reordenar las posiciones", () => {
  it("las deja en el orden de la lista", async () => {
    const database = await migratedDatabase();
    const clubId = await seededClubId(database);
    const goalkeeper = await positionIdNamed(database, "Goalkeeper");
    const defender = await positionIdNamed(database, "Defender");
    const forward = await positionIdNamed(database, "Forward");

    const outcome = await reorderPositions(database, clubId, [
      forward,
      goalkeeper,
      defender,
    ]);

    expect(outcome).toEqual({ outcome: "reordered" });
    expect(await activePositions(database)).toEqual([
      "Forward|Ataque",
      "Goalkeeper|Portería",
      "Defender|Defensa",
    ]);
  });

  it("no cambia nada si la lista no es exactamente la de las activas", async () => {
    const database = await migratedDatabase();
    const clubId = await seededClubId(database);
    const goalkeeper = await positionIdNamed(database, "Goalkeeper");
    const forward = await positionIdNamed(database, "Forward");

    const outcome = await reorderPositions(database, clubId, [
      forward,
      goalkeeper,
    ]);

    expect(outcome).toEqual({ outcome: "positions_changed" });
    expect(await activePositions(database)).toEqual([
      "Goalkeeper|Portería",
      "Defender|Defensa",
      "Forward|Ataque",
    ]);
  });

  it("no acepta una posición repetida en la lista", async () => {
    const database = await migratedDatabase();
    const clubId = await seededClubId(database);
    const goalkeeper = await positionIdNamed(database, "Goalkeeper");
    const defender = await positionIdNamed(database, "Defender");

    const outcome = await reorderPositions(database, clubId, [
      goalkeeper,
      defender,
      defender,
    ]);

    expect(outcome).toEqual({ outcome: "positions_changed" });
  });
});

describeConPostgres("archivar y reactivar una posición", () => {
  it("la archiva y quien la tenía la conserva", async () => {
    const database = await migratedDatabase();
    const clubId = await seededClubId(database);
    const defender = await positionIdNamed(database, "Defender");
    const userId = await insertMemberWithPosition(database, defender);

    const outcome = await setArchived(
      database,
      { clubId, positionId: defender },
      true,
    );

    expect(outcome).toEqual({ outcome: "changed" });
    expect(await activePositions(database)).toEqual([
      "Goalkeeper|Portería",
      "Forward|Ataque",
    ]);
    expect(await memberPositionId(database, userId)).toBe(defender);
  });

  it("archivar la que ya lo está no cambia nada", async () => {
    const database = await migratedDatabase();
    const clubId = await seededClubId(database);
    const defender = await positionIdNamed(database, "Defender");
    await setArchived(database, { clubId, positionId: defender }, true);

    const outcome = await setArchived(
      database,
      { clubId, positionId: defender },
      true,
    );

    expect(outcome).toEqual({ outcome: "unchanged" });
  });

  it("reactivarla la devuelve al final de las activas", async () => {
    const database = await migratedDatabase();
    const clubId = await seededClubId(database);
    const goalkeeper = await positionIdNamed(database, "Goalkeeper");
    await setArchived(database, { clubId, positionId: goalkeeper }, true);

    const outcome = await setArchived(
      database,
      { clubId, positionId: goalkeeper },
      false,
    );

    expect(outcome).toEqual({ outcome: "changed" });
    expect(await activePositions(database)).toEqual([
      "Defender|Defensa",
      "Forward|Ataque",
      "Goalkeeper|Portería",
    ]);
  });

  it("no encuentra la posición de otro club", async () => {
    const database = await migratedDatabase();
    const otherClubId = await database.query(
      `insert into public.clubs (slug, name) values ('otro-club', 'Otro Club')
       returning id`,
    );
    const defender = await positionIdNamed(database, "Defender");

    const outcome = await setArchived(
      database,
      { clubId: otherClubId, positionId: defender },
      true,
    );

    expect(outcome).toEqual({ outcome: "not_found" });
    expect(await activePositions(database)).toHaveLength(3);
  });
});

describeConPostgres("quién puede llamar a las funciones", () => {
  it.each([
    "create_club_position(uuid, text, text)",
    "rename_club_position(uuid, uuid, text, text)",
    "reorder_club_positions(uuid, uuid[])",
    "set_club_position_archived(uuid, uuid, boolean)",
  ])("sólo service_role ejecuta %s", async (signature) => {
    const database = await migratedDatabase();

    const grantees = await database.query(
      `select string_agg(r.rolname, ',' order by r.rolname)
         from pg_roles r
        where r.rolname in ('anon', 'authenticated', 'service_role')
          and has_function_privilege(r.rolname, 'public.${signature}', 'execute')`,
    );

    expect(grantees).toBe("service_role");
  });
});
