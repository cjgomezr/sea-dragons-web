import { expect, it } from "vitest";
import {
  type RunResult,
  type TemporaryDatabase,
  applyRepositoryMigrations,
  describeConPostgres,
  migratedDatabase,
} from "../../support/postgres";

/**
 * `public.members` contra un Postgres desechable: columnas, restricciones,
 * privilegios y policies. Aquí no hay PostgREST, así que los casos de policy
 * hacen a mano lo que PostgREST hace por su cuenta (cambiar al rol de la API y
 * dejar el `sub` del JWT donde `auth.uid()` lo busca).
 *
 * Los mismos casos de policy están además en
 * `tests/rls/members.rls.test.ts`, contra `seadragons-dev`. No es la misma
 * prueba dos veces: esa ataca el proyecto de verdad, con su PostgREST, su JWT
 * y sus privilegios por defecto, y se salta cuando no hay credenciales, que es
 * siempre en CI. Sin las de aquí, la frontera de NFR-004 no la comprueba nadie
 * en un PR.
 */

/** Un Postgres limpio no trae identidades: el sustrato de CI deja la tabla
 * vacía y cada caso crea la suya. */
async function insertAuthUser(database: TemporaryDatabase): Promise<string> {
  return database.query(
    "insert into auth.users (id) values (gen_random_uuid()) returning id",
  );
}

async function seededClubId(database: TemporaryDatabase): Promise<string> {
  return database.query(
    "select id from public.clubs where slug = 'victoria-seadragons'",
  );
}

/**
 * Inserta un miembro válido con los campos que `overrides` reemplace. Los
 * valores son SQL literal, no datos: una cadena va entre comillas
 * (`{ role: "'Owner'" }`) y una expresión va tal cual
 * (`{ club_id: "gen_random_uuid()" }`). Es lo que permite pedirle a un caso que
 * inserte `null` donde la columna no lo admite.
 */
async function insertMember(
  database: TemporaryDatabase,
  overrides: Readonly<Record<string, string>> = {},
): Promise<RunResult> {
  const values: Record<string, string> = {
    club_id: `'${await seededClubId(database)}'`,
    user_id: `'${await insertAuthUser(database)}'`,
    full_name: "'Nerea Silva'",
    email: "'nerea.silva@example.test'",
    ...overrides,
  };
  const columns = Object.keys(values).join(", ");
  return database.attempt(
    `insert into public.members (${columns}) values (${Object.values(values).join(", ")})`,
  );
}

describeConPostgres("migración de miembros", () => {
  it("deja la tabla con las columnas, los tipos y la obligatoriedad que pide el ticket", async () => {
    const database = await migratedDatabase();

    const columnas = await database.query(
      `select column_name || ' ' || data_type || ' null=' || is_nullable
         from information_schema.columns
        where table_schema = 'public' and table_name = 'members'
        order by column_name`,
    );

    // Las nulables lo son por FR-083: una cuenta nace `incomplete` justo
    // porque le faltan el país, la fecha de nacimiento o el tipo de membresía,
    // y la pantalla de completar registro es la que los rellena.
    expect(columnas.split("\n")).toEqual([
      "account_status text null=NO",
      "auf_expiry date null=YES",
      "auf_number text null=YES",
      "auf_verified_at timestamp with time zone null=YES",
      "club_id uuid null=NO",
      "country text null=YES",
      "created_at timestamp with time zone null=NO",
      "date_of_birth date null=YES",
      "email text null=NO",
      "email_locale text null=NO",
      "experience_level text null=YES",
      "full_name text null=NO",
      "gender text null=YES",
      "guardian_consent_at timestamp with time zone null=YES",
      "guardian_email text null=YES",
      "guardian_name text null=YES",
      "id uuid null=NO",
      "joined_on date null=NO",
      "membership_type text null=YES",
      "photo_path text null=YES",
      "position text null=YES",
      "role text null=NO",
      "user_id uuid null=NO",
    ]);
  });

  it("es idempotente: aplicada dos veces no falla ni duplica nada", async () => {
    const database = await migratedDatabase();
    const despuesDeLaPrimera = await database.snapshot();

    const segunda = await applyRepositoryMigrations(database);

    expect(segunda.code, segunda.stderr).toBe(0);
    // La comparación sólo vale si la descripción trae la tabla: dos cadenas
    // vacías también son iguales.
    expect(despuesDeLaPrimera).toMatch(/tabla members rls=t/);
    expect(await database.snapshot()).toBe(despuesDeLaPrimera);
  });

  it("da a toda cuenta nueva el rol Player y el estado incomplete", async () => {
    // FR-008 y FR-083: ni el rol ni el estado los elige quien se registra.
    const database = await migratedDatabase();

    const insercion = await insertMember(database);

    expect(insercion.code, insercion.stderr).toBe(0);
    expect(
      await database.query("select role, account_status from public.members"),
    ).toBe("Player|incomplete");
  });

  it("borra la fila del miembro cuando se borra su identidad de autenticación", async () => {
    // La fila de miembro y la cuenta de autenticación son dos cosas, pero la
    // primera no tiene sentido sin la segunda: sin cascada quedaría un socio
    // al que nadie puede volver a entrar, con sus datos personales dentro.
    const database = await migratedDatabase();
    const insercion = await insertMember(database);
    expect(insercion.code, insercion.stderr).toBe(0);

    await database.query("delete from auth.users");

    expect(await database.query("select count(*) from public.members")).toBe(
      "0",
    );
  });
});

describeConPostgres("restricciones de miembros", () => {
  it("rechaza un estado de cuenta fuera del conjunto", async () => {
    const database = await migratedDatabase();

    const insercion = await insertMember(database, {
      account_status: "'suspended'",
    });

    expect(insercion.code).toBeGreaterThan(0);
    expect(insercion.stderr).toMatch(/members_account_status_check/);
  });

  it("rechaza un tipo de membresía fuera del conjunto", async () => {
    const database = await migratedDatabase();

    const insercion = await insertMember(database, {
      membership_type: "'Family'",
    });

    expect(insercion.code).toBeGreaterThan(0);
    expect(insercion.stderr).toMatch(/members_membership_type_check/);
  });

  it("rechaza un rol fuera del conjunto de cuatro", async () => {
    // FR-012 y AC-048: exactamente cuatro roles, y quien los reparte es la
    // base, no la aplicación.
    const database = await migratedDatabase();

    const insercion = await insertMember(database, { role: "'Owner'" });

    expect(insercion.code).toBeGreaterThan(0);
    expect(insercion.stderr).toMatch(/members_role_check/);
  });

  it("rechaza una fila sin club_id", async () => {
    // NFR-009: ninguna tabla del proyecto nace sin club.
    const database = await migratedDatabase();

    const insercion = await insertMember(database, { club_id: "null" });

    expect(insercion.code).toBeGreaterThan(0);
    // El nombre de la restricción y no sólo "club_id": el texto de la propia
    // sentencia también trae la palabra, así que un error cualquiera (la tabla
    // no existe, por ejemplo) daría el caso por bueno.
    expect(insercion.stderr).toMatch(
      /null value in column "club_id".*violates not-null constraint/s,
    );
  });

  it("rechaza una fila cuyo club no existe", async () => {
    const database = await migratedDatabase();

    const insercion = await insertMember(database, {
      club_id: "gen_random_uuid()",
    });

    expect(insercion.code).toBeGreaterThan(0);
    expect(insercion.stderr).toMatch(/members_club_id_fkey/);
  });

  it("rechaza dos miembros para la misma identidad de autenticación", async () => {
    const database = await migratedDatabase();
    const userId = await insertAuthUser(database);
    const primera = await insertMember(database, { user_id: `'${userId}'` });
    expect(primera.code, primera.stderr).toBe(0);

    const segunda = await insertMember(database, { user_id: `'${userId}'` });

    expect(segunda.code).toBeGreaterThan(0);
    expect(segunda.stderr).toMatch(/members_user_id_key/);
  });
});

type ApiIdentity =
  | { readonly role: "anon" }
  | { readonly role: "authenticated"; readonly subject: string };

/** Envuelve `sql` en lo que PostgREST monta antes de cada consulta: el rol de
 * la API y, si hay sesión, el `sub` del JWT que `auth.uid()` lee. */
function asApiIdentity(identity: ApiIdentity, sql: string): string {
  const claims =
    identity.role === "anon"
      ? ""
      : `set request.jwt.claims = '{"sub":"${identity.subject}"}'; `;
  return `set role ${identity.role}; ${claims}${sql}`;
}

/** Etiqueta que psql imprime por cada `set` de `asApiIdentity`, entre las
 * filas que sí interesan. */
const SET_COMMAND_TAG = "SET";

function rowsOf(result: RunResult): string[] {
  return result.stdout
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && line !== SET_COMMAND_TAG);
}

interface SeededMember {
  readonly userId: string;
  readonly email: string;
}

async function seedMember(
  database: TemporaryDatabase,
  clubId: string,
  email: string,
): Promise<SeededMember> {
  const userId = await insertAuthUser(database);
  await database.query(
    `insert into public.members (club_id, user_id, full_name, email)
     values ('${clubId}', '${userId}', 'Socio de prueba', '${email}')`,
  );
  return { userId, email };
}

async function seedOtherClubId(database: TemporaryDatabase): Promise<string> {
  return database.query(
    `insert into public.clubs (slug, name)
     values ('club-de-prueba', 'Club de prueba') returning id`,
  );
}

describeConPostgres("policies de miembros", () => {
  it("deja a un miembro ver su propia fila y ninguna de otro club", async () => {
    const database = await migratedDatabase();
    const socio = await seedMember(
      database,
      await seededClubId(database),
      "socia@example.test",
    );
    await seedMember(
      database,
      await seedOtherClubId(database),
      "forastero@example.test",
    );

    const lectura = await database.attempt(
      asApiIdentity(
        { role: "authenticated", subject: socio.userId },
        "select email from public.members order by email",
      ),
    );

    expect(lectura.code, lectura.stderr).toBe(0);
    expect(rowsOf(lectura)).toEqual([socio.email]);
    // Y las dos filas estaban ahí: sin esto el caso pasaría igual con una base
    // en la que la segunda nunca se sembró.
    expect(await database.query("select count(*) from public.members")).toBe(
      "2",
    );
  });

  it("no deja a un cliente anónimo ni mirar la tabla", async () => {
    const database = await migratedDatabase();
    await seedMember(
      database,
      await seededClubId(database),
      "socia@example.test",
    );

    const lectura = await database.attempt(
      asApiIdentity({ role: "anon" }, "select email from public.members"),
    );

    expect(lectura.code).toBeGreaterThan(0);
    expect(lectura.stderr).toMatch(/permission denied for (table|column)/);
  });

  it("no deja al dueño de la fila cambiar su propio rol", async () => {
    // Se exige el error, no sólo que el valor no cambie. Sin el `revoke` de la
    // migración el privilegio existe y lo que niega es RLS, que no tiene policy
    // de update: el `update` afecta a cero filas y sale en verde. Un cliente
    // que recibe eso cree que guardó.
    const database = await migratedDatabase();
    const socio = await seedMember(
      database,
      await seededClubId(database),
      "socia@example.test",
    );

    const intento = await database.attempt(
      asApiIdentity(
        { role: "authenticated", subject: socio.userId },
        `update public.members set role = 'Admin' where user_id = '${socio.userId}'`,
      ),
    );

    expect(intento.code).toBeGreaterThan(0);
    expect(intento.stderr).toMatch(/permission denied for (table|column)/);
    expect(
      await database.query(
        `select role from public.members where user_id = '${socio.userId}'`,
      ),
    ).toBe("Player");
  });

  it("no deja al dueño de la fila cambiar su propio estado de cuenta", async () => {
    const database = await migratedDatabase();
    const socio = await seedMember(
      database,
      await seededClubId(database),
      "socia@example.test",
    );

    const intento = await database.attempt(
      asApiIdentity(
        { role: "authenticated", subject: socio.userId },
        `update public.members set account_status = 'active' where user_id = '${socio.userId}'`,
      ),
    );

    expect(intento.code).toBeGreaterThan(0);
    expect(intento.stderr).toMatch(/permission denied for (table|column)/);
    expect(
      await database.query(
        `select account_status from public.members where user_id = '${socio.userId}'`,
      ),
    ).toBe("incomplete");
  });
});

describeConPostgres("privilegios de miembros", () => {
  it("deja a anon sin ningún privilegio y a authenticated sólo con la lectura", async () => {
    // Esto es la mitad de la frontera de NFR-004 que no es una policy: en un
    // Supabase de verdad toda tabla nueva nace con todos los privilegios
    // concedidos a anon y a authenticated, así que sin el `revoke` un miembro
    // tendría UPDATE sobre su propio rol y su propio estado de cuenta.
    const database = await migratedDatabase();

    const privilegios = await database.query(
      `select grantee || ' ' || privilege_type
         from information_schema.table_privileges
        where table_schema = 'public' and table_name = 'members'
          and grantee in ('anon', 'authenticated')
        order by grantee, privilege_type`,
    );

    expect(privilegios).toBe("authenticated SELECT");
  });
});
