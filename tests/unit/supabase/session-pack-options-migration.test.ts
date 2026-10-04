import { describe, expect, it } from "vitest";
import {
  type TemporaryDatabase,
  applyRepositoryMigrations,
  databaseBeforeMigration,
  describeConPostgres,
  migratedDatabase,
} from "../../support/postgres";

/**
 * `0056_club_session_pack_options.sql` contra un Postgres desechable (#469,
 * RF-4 del PRD de E13, D2 y FR-080). Los packs de sesiones que el club ofrece
 * a sus Casual: un tamaño de 1 a 50, una vez por club, en el orden que decide
 * el Admin o el Committee. Cada club, el de antes y los nuevos, empieza con
 * los de 5 y 10.
 */

const SEEDED_CLUB = "victoria-seadragons";
const MIGRATION_PREFIX = "0056";
const DEFAULT_PACKS = "5,10";

type Member = { readonly clubId: string; readonly userId: string };

function seededClubId(database: TemporaryDatabase): Promise<string> {
  return database.query(
    `select id from public.clubs where slug = '${SEEDED_CLUB}'`,
  );
}

function createOtherClub(database: TemporaryDatabase): Promise<string> {
  return database.query(
    `insert into public.clubs (slug, name) values ('otro-club', 'Otro Club')
     returning id`,
  );
}

async function seedMember(
  database: TemporaryDatabase,
  options: { readonly clubId: string; readonly accountStatus: string },
): Promise<Member> {
  const userId = await database.query(
    "insert into auth.users (id) values (gen_random_uuid()) returning id",
  );
  await database.query(
    `insert into public.members
       (club_id, user_id, full_name, email, account_status)
     values ('${options.clubId}', '${userId}', 'Carla Casual',
             '${userId}@example.test', '${options.accountStatus}')`,
  );
  return { clubId: options.clubId, userId };
}

/** Los tamaños del club en su orden, separados por comas. */
function packsOf(database: TemporaryDatabase, clubId: string): Promise<string> {
  return database.query(
    `select coalesce(string_agg(sessions::text, ',' order by position), '')
       from public.club_session_pack_options
      where club_id = '${clubId}'`,
  );
}

function insertPack(
  database: TemporaryDatabase,
  pack: {
    readonly clubId: string;
    readonly sessions: number;
    readonly position: number;
  },
): Promise<{ readonly code: number; readonly stderr: string }> {
  return database.attempt(
    `insert into public.club_session_pack_options (club_id, sessions, position)
     values ('${pack.clubId}', ${pack.sessions}, ${pack.position})`,
  );
}

function replacePacks(
  database: TemporaryDatabase,
  clubId: string,
  sessions: string,
): Promise<{ readonly code: number; readonly stderr: string }> {
  return database.attempt(
    `select public.replace_club_session_pack_options(
       '${clubId}', array[${sessions}]::integer[])`,
  );
}

function asMember(member: Member): string {
  return `set role authenticated;
    set request.jwt.claims = '{"sub":"${member.userId}"}';`;
}

describeConPostgres("los packs de sesiones del club en la base", () => {
  describe("los packs de inicio", () => {
    it("el club que ya existía ofrece 5 y 10, en ese orden", async () => {
      const database = await databaseBeforeMigration(MIGRATION_PREFIX);

      const applied = await applyRepositoryMigrations(database);

      expect(applied.code, applied.stderr).toBe(0);
      await expect(
        packsOf(database, await seededClubId(database)),
      ).resolves.toBe(DEFAULT_PACKS);
    });

    it("un club creado después de la migración también nace con 5 y 10", async () => {
      const database = await migratedDatabase();

      const clubId = await createOtherClub(database);

      await expect(packsOf(database, clubId)).resolves.toBe(DEFAULT_PACKS);
    });

    it("volver a aplicarla no resucita un pack que el club quitó", async () => {
      const database = await migratedDatabase();
      const clubId = await seededClubId(database);
      await replacePacks(database, clubId, "8");

      const again = await applyRepositoryMigrations(database);

      expect(again.code, again.stderr).toBe(0);
      await expect(packsOf(database, clubId)).resolves.toBe("8");
    });
  });

  describe("las reglas de la tabla", () => {
    it.each([0, 51])("rechaza un pack de %i sesiones", async (sessions) => {
      const database = await migratedDatabase();

      const result = await insertPack(database, {
        clubId: await seededClubId(database),
        sessions,
        position: 3,
      });

      expect(result.code).toBeGreaterThan(0);
      expect(result.stderr).toContain(
        "club_session_pack_options_sessions_check",
      );
    });

    it("rechaza el mismo tamaño dos veces en un club", async () => {
      const database = await migratedDatabase();

      const result = await insertPack(database, {
        clubId: await seededClubId(database),
        sessions: 5,
        position: 3,
      });

      expect(result.code).toBeGreaterThan(0);
      expect(result.stderr).toContain(
        "club_session_pack_options_club_id_sessions_key",
      );
    });

    it("deja el mismo tamaño en dos clubes distintos", async () => {
      const database = await migratedDatabase();
      const otherClub = await createOtherClub(database);
      await replacePacks(database, otherClub, "20");

      const result = await insertPack(database, {
        clubId: await seededClubId(database),
        sessions: 20,
        position: 3,
      });

      expect(result.code, result.stderr).toBe(0);
    });
  });

  describe("replace_club_session_pack_options", () => {
    it("deja la lista nueva en ese orden", async () => {
      const database = await migratedDatabase();
      const clubId = await seededClubId(database);

      const result = await replacePacks(database, clubId, "10, 3, 20");

      expect(result.code, result.stderr).toBe(0);
      await expect(packsOf(database, clubId)).resolves.toBe("10,3,20");
    });

    it("no toca los packs de otro club", async () => {
      const database = await migratedDatabase();
      const otherClub = await createOtherClub(database);

      await replacePacks(database, await seededClubId(database), "7");

      await expect(packsOf(database, otherClub)).resolves.toBe(DEFAULT_PACKS);
    });

    it("rechaza una lista vacía y no cambia nada", async () => {
      const database = await migratedDatabase();
      const clubId = await seededClubId(database);

      const result = await replacePacks(database, clubId, "");

      expect(result.code).toBeGreaterThan(0);
      await expect(packsOf(database, clubId)).resolves.toBe(DEFAULT_PACKS);
    });

    it("rechaza un tamaño repetido y no cambia nada", async () => {
      const database = await migratedDatabase();
      const clubId = await seededClubId(database);

      const result = await replacePacks(database, clubId, "4, 4");

      expect(result.code).toBeGreaterThan(0);
      await expect(packsOf(database, clubId)).resolves.toBe(DEFAULT_PACKS);
    });
  });

  it("es idempotente: aplicada dos veces no falla ni cambia nada", async () => {
    const database = await migratedDatabase();
    const afterFirst = await database.snapshot();

    const second = await applyRepositoryMigrations(database);

    expect(second.code, second.stderr).toBe(0);
    expect(afterFirst).toMatch(/tabla club_session_pack_options rls=t/);
    expect(await database.snapshot()).toBe(afterFirst);
  });

  it("schema-expected.txt declara lo que la migración deja", async () => {
    const database = await migratedDatabase();

    const check = await database.checkSchema();

    expect(check.code, check.stdout + check.stderr).toBe(0);
  });

  describe("privilegios", () => {
    it("deja a anon sin privilegios y a authenticated sólo con la lectura", async () => {
      const database = await migratedDatabase();

      const grants = await database.query(
        `select grantee || ' ' || string_agg(privilege_type, ',' order by privilege_type)
           from information_schema.role_table_grants
          where table_schema = 'public'
            and table_name = 'club_session_pack_options'
            and grantee in ('anon', 'authenticated')
          group by grantee order by grantee`,
      );

      expect(grants).toBe("authenticated SELECT");
    });

    it("da a service_role la lectura y la escritura", async () => {
      const database = await migratedDatabase();

      const grants = await database.query(
        `select string_agg(privilege_type, ',' order by privilege_type)
           from information_schema.role_table_grants
          where table_schema = 'public'
            and table_name = 'club_session_pack_options'
            and grantee = 'service_role'
            and privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE')`,
      );

      expect(grants).toBe("DELETE,INSERT,SELECT,UPDATE");
    });

    it("una cuenta activa lee sólo los packs de su club", async () => {
      const database = await migratedDatabase();
      const member = await seedMember(database, {
        clubId: await seededClubId(database),
        accountStatus: "active",
      });
      await replacePacks(database, await createOtherClub(database), "30");

      const visible = await database.query(
        `${asMember(member)}
         select string_agg(sessions::text, ',' order by position)
           from public.club_session_pack_options`,
      );

      expect(visible).toBe(DEFAULT_PACKS);
    });

    it("una cuenta que no está activa no lee ninguno", async () => {
      const database = await migratedDatabase();
      const member = await seedMember(database, {
        clubId: await seededClubId(database),
        accountStatus: "incomplete",
      });

      const visible = await database.query(
        `${asMember(member)}
         select count(*) from public.club_session_pack_options`,
      );

      expect(visible).toBe("0");
    });

    it("una cuenta activa no puede escribir ninguno", async () => {
      const database = await migratedDatabase();
      const member = await seedMember(database, {
        clubId: await seededClubId(database),
        accountStatus: "active",
      });

      const writes = await Promise.all([
        database.attempt(
          `${asMember(member)} insert into public.club_session_pack_options
             (club_id, sessions, position)
           values ('${member.clubId}', 7, 3)`,
        ),
        database.attempt(
          `${asMember(member)}
           update public.club_session_pack_options set sessions = 9`,
        ),
        database.attempt(
          `${asMember(member)} delete from public.club_session_pack_options`,
        ),
      ]);

      for (const write of writes) {
        expect(write.code).toBeGreaterThan(0);
        expect(write.stderr).toMatch(/permission denied/);
      }
    });

    it("sólo service_role ejecuta replace_club_session_pack_options", async () => {
      const database = await migratedDatabase();

      const grantees = await database.query(
        `select string_agg(r.rolname, ',' order by r.rolname)
           from pg_roles r
          where r.rolname in ('anon', 'authenticated', 'service_role')
            and has_function_privilege(
                  r.rolname,
                  'public.replace_club_session_pack_options(uuid, integer[])',
                  'execute')`,
      );

      expect(grantees).toBe("service_role");
    });
  });
});
