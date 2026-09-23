import { expect, it } from "vitest";
import {
  type RunResult,
  type TemporaryDatabase,
  applyRepositoryMigrations,
  databaseBeforeMigration,
  describeConPostgres,
  migratedDatabase,
} from "../../support/postgres";

/**
 * `0016_member_profile_fields.sql` contra un Postgres desechable (#237, RF-1
 * del PRD de E5). El directorio, el perfil propio y el alta por el Admin viven
 * de estos seis datos, y los tres conjuntos cerrados los cierra la base: una
 * posición inventada no debe poder entrar por la API ni por un script de
 * soporte.
 */

/** El largo que la migración nombra para el registro federativo. */
const AUF_NUMBER_MAX_LENGTH = 40;

const POSITIONS = ["Goalkeeper", "Defender", "Forward"] as const;
const EXPERIENCE_LEVELS = ["Beginner", "Intermediate", "Advanced"] as const;
const GENDERS = ["female", "male", "non_binary", "undisclosed"] as const;

/** La migración de este ticket: el corte que separa "la base de ayer" de "la
 * base con los campos nuevos". */
const THIS_TICKETS_MIGRATION = "0016";

/**
 * Inserta un miembro con los valores SQL literales de `overrides`, igual que el
 * ayudante de `members-migration.test.ts`: una cadena va entre comillas y una
 * expresión va tal cual, que es lo que permite pedirle a un caso que inserte
 * `null` donde la columna no lo admite.
 */
async function insertMember(
  database: TemporaryDatabase,
  overrides: Readonly<Record<string, string>> = {},
): Promise<RunResult> {
  const clubId = await database.query(
    "select id from public.clubs where slug = 'victoria-seadragons'",
  );
  const userId = await database.query(
    "insert into auth.users (id) values (gen_random_uuid()) returning id",
  );
  const values: Record<string, string> = {
    club_id: `'${clubId}'`,
    user_id: `'${userId}'`,
    full_name: "'Nerea Silva'",
    email: `'${userId}@example.test'`,
    ...overrides,
  };
  const columns = Object.keys(values).join(", ");
  return database.attempt(
    `insert into public.members (${columns}) values (${Object.values(values).join(", ")})`,
  );
}

/** Parte de la base de ayer: la de antes de esta migración. */
function databaseBeforeThisTicket(): Promise<TemporaryDatabase> {
  return databaseBeforeMigration(THIS_TICKETS_MIGRATION);
}

describeConPostgres("campos de la ficha del socio", () => {
  it("deja las seis columnas con su tipo y su obligatoriedad", async () => {
    const database = await migratedDatabase();

    const columnas = await database.query(
      `select column_name || ' ' || data_type || ' null=' || is_nullable
         from information_schema.columns
        where table_schema = 'public' and table_name = 'members'
          and column_name in ('position', 'experience_level', 'gender',
                              'auf_number', 'auf_expiry', 'joined_on')
        order by column_name`,
    );

    // Todas opcionales salvo `joined_on`: quien no ha completado su perfil no
    // tiene posición ni nivel, pero desde algún día es socio.
    expect(columnas.split("\n")).toEqual([
      "auf_expiry date null=YES",
      "auf_number text null=YES",
      "experience_level text null=YES",
      "gender text null=YES",
      "joined_on date null=NO",
      "position text null=YES",
    ]);
  });

  it("acepta una ficha con los seis datos puestos", async () => {
    const database = await migratedDatabase();

    const insercion = await insertMember(database, {
      position: "'Forward'",
      experience_level: "'Advanced'",
      gender: "'non_binary'",
      auf_number: "'AUF-00421'",
      auf_expiry: "'2027-06-30'",
      joined_on: "'2021-02-14'",
    });

    expect(insercion.code, insercion.stderr).toBe(0);
    expect(
      await database.query(
        `select position || '|' || experience_level || '|' || gender
                || '|' || auf_number || '|' || auf_expiry || '|' || joined_on
           from public.members`,
      ),
    ).toBe("Forward|Advanced|non_binary|AUF-00421|2027-06-30|2021-02-14");
  });

  it("deja los campos nuevos vacíos cuando nadie los escribe", async () => {
    const database = await migratedDatabase();

    const insercion = await insertMember(database);

    expect(insercion.code, insercion.stderr).toBe(0);
    expect(
      await database.query(
        `select count(*) from public.members
          where position is null and experience_level is null
            and gender is null and auf_number is null and auf_expiry is null`,
      ),
    ).toBe("1");
  });

  it.each(POSITIONS)("acepta la posición %s", async (position) => {
    const database = await migratedDatabase();

    const insercion = await insertMember(database, {
      position: `'${position}'`,
    });

    expect(insercion.code, insercion.stderr).toBe(0);
  });

  it.each(["Centre", "forward", "Goalie", ""])(
    "rechaza una posición que no existe en el deporte: '%s'",
    async (position) => {
      const database = await migratedDatabase();

      const insercion = await insertMember(database, {
        position: `'${position}'`,
      });

      expect(insercion.code).toBeGreaterThan(0);
      expect(insercion.stderr).toContain("members_position_check");
    },
  );

  it.each(EXPERIENCE_LEVELS)("acepta el nivel %s", async (level) => {
    const database = await migratedDatabase();

    const insercion = await insertMember(database, {
      experience_level: `'${level}'`,
    });

    expect(insercion.code, insercion.stderr).toBe(0);
  });

  it.each(["Expert", "beginner", "Novato", ""])(
    "rechaza un nivel fuera del conjunto: '%s'",
    async (level) => {
      const database = await migratedDatabase();

      const insercion = await insertMember(database, {
        experience_level: `'${level}'`,
      });

      expect(insercion.code).toBeGreaterThan(0);
      expect(insercion.stderr).toContain("members_experience_level_check");
    },
  );

  it.each(GENDERS)("acepta el género %s", async (gender) => {
    const database = await migratedDatabase();

    const insercion = await insertMember(database, { gender: `'${gender}'` });

    expect(insercion.code, insercion.stderr).toBe(0);
  });

  it.each(["Female", "nonbinary", "otro", ""])(
    "rechaza un género que la pantalla no sabría traducir: '%s'",
    async (gender) => {
      const database = await migratedDatabase();

      const insercion = await insertMember(database, { gender: `'${gender}'` });

      expect(insercion.code).toBeGreaterThan(0);
      expect(insercion.stderr).toContain("members_gender_check");
    },
  );

  it("acepta un socio sin número de AUF: la mayoría no lo tiene", async () => {
    const database = await migratedDatabase();

    const insercion = await insertMember(database, { auf_number: "null" });

    expect(insercion.code, insercion.stderr).toBe(0);
  });

  it(`acepta un número de AUF de ${AUF_NUMBER_MAX_LENGTH} caracteres`, async () => {
    const database = await migratedDatabase();

    const insercion = await insertMember(database, {
      auf_number: `repeat('7', ${AUF_NUMBER_MAX_LENGTH})`,
    });

    expect(insercion.code, insercion.stderr).toBe(0);
  });

  it(`rechaza un número de AUF de más de ${AUF_NUMBER_MAX_LENGTH} caracteres`, async () => {
    const database = await migratedDatabase();

    const insercion = await insertMember(database, {
      auf_number: `repeat('7', ${AUF_NUMBER_MAX_LENGTH + 1})`,
    });

    expect(insercion.code).toBeGreaterThan(0);
    expect(insercion.stderr).toContain("members_auf_number_length");
  });

  it.each(["", "   "])(
    "rechaza un número de AUF en blanco: '%s'",
    async (aufNumber) => {
      // En blanco no es "no tiene": para eso está el nulo. Una cadena vacía
      // pasaría por un registro federativo al día cuando no lo hay (BR-008).
      const database = await migratedDatabase();

      const insercion = await insertMember(database, {
        auf_number: `'${aufNumber}'`,
      });

      expect(insercion.code).toBeGreaterThan(0);
      expect(insercion.stderr).toContain("members_auf_number_length");
    },
  );

  it("acepta un vencimiento anterior a la fecha de ingreso", async () => {
    // Que el vencimiento no pueda ser anterior es regla de la aplicación, no
    // de la base: un registro viejo importado no debe impedir guardar la fila.
    const database = await migratedDatabase();

    const insercion = await insertMember(database, {
      auf_number: "'AUF-00099'",
      auf_expiry: "'2019-01-31'",
      joined_on: "'2023-08-01'",
    });

    expect(insercion.code, insercion.stderr).toBe(0);
  });

  it("pone la fecha de hoy en Melbourne al socio que se inserta sin ella", async () => {
    const database = await migratedDatabase();

    const insercion = await insertMember(database);

    expect(insercion.code, insercion.stderr).toBe(0);
    expect(await database.query("select joined_on from public.members")).toBe(
      await database.query(
        "select (now() at time zone 'Australia/Melbourne')::date",
      ),
    );
  });

  it("rechaza dejar a un socio sin fecha de ingreso", async () => {
    const database = await migratedDatabase();

    const insercion = await insertMember(database, { joined_on: "null" });

    expect(insercion.code).toBeGreaterThan(0);
    expect(insercion.stderr).toContain("joined_on");
  });
});

describeConPostgres("el socio que ya existía cuando llegó la ficha", () => {
  it("conserva sus datos, estrena los campos vacíos y hereda su fecha de alta", async () => {
    const database = await databaseBeforeThisTicket();
    const insercion = await insertMember(database, { country: "'Uruguay'" });
    expect(insercion.code, insercion.stderr).toBe(0);
    // Un instante cuya fecha en Melbourne (UTC+11 en marzo) NO es la misma que
    // en UTC: así el caso distingue el día del club del día del servidor.
    await database.query(
      "update public.members set created_at = '2024-03-05 23:30:00+00'",
    );

    const aplicada = await applyRepositoryMigrations(database);

    expect(aplicada.code, aplicada.stderr).toBe(0);
    expect(
      await database.query(
        `select full_name || '|' || country || '|' || joined_on
           from public.members`,
      ),
    ).toBe("Nerea Silva|Uruguay|2024-03-06");
    expect(
      await database.query(
        `select count(*) from public.members
          where position is null and experience_level is null
            and gender is null and auf_number is null and auf_expiry is null`,
      ),
    ).toBe("1");
  });

  it("no le vuelve a mover la fecha de ingreso si la migración se repite", async () => {
    const database = await databaseBeforeThisTicket();
    const insercion = await insertMember(database);
    expect(insercion.code, insercion.stderr).toBe(0);
    await database.query(
      "update public.members set created_at = '2022-09-19 04:00:00+00'",
    );
    const primera = await applyRepositoryMigrations(database);
    expect(primera.code, primera.stderr).toBe(0);

    const segunda = await applyRepositoryMigrations(database);

    expect(segunda.code, segunda.stderr).toBe(0);
    expect(await database.query("select joined_on from public.members")).toBe(
      "2022-09-19",
    );
  });

  it("es idempotente: aplicada dos veces no cambia el esquema", async () => {
    const database = await migratedDatabase();
    const despuesDeLaPrimera = await database.snapshot();

    const segunda = await applyRepositoryMigrations(database);

    expect(segunda.code, segunda.stderr).toBe(0);
    // La comparación sólo vale si la descripción trae las columnas nuevas: dos
    // cadenas vacías también son iguales.
    expect(despuesDeLaPrimera).toMatch(/columna members\.joined_on/);
    expect(await database.snapshot()).toBe(despuesDeLaPrimera);
  });
});

describeConPostgres("la ficha no abre ninguna puerta nueva", () => {
  it("deja a un socio leer sus campos nuevos y ninguno de otro socio", async () => {
    const database = await migratedDatabase();
    const propia = await insertMember(database, { position: "'Defender'" });
    expect(propia.code, propia.stderr).toBe(0);
    const ajena = await insertMember(database, { position: "'Forward'" });
    expect(ajena.code, ajena.stderr).toBe(0);
    const userId = await database.query(
      "select user_id from public.members where position = 'Defender'",
    );

    const lectura = await database.attempt(
      `set role authenticated; set request.jwt.claims = '{"sub":"${userId}"}';
       select position from public.members`,
    );

    expect(lectura.code, lectura.stderr).toBe(0);
    expect(lectura.stdout).toContain("Defender");
    expect(lectura.stdout).not.toContain("Forward");
  });

  it("no deja al dueño de la fila escribirse su propio número de AUF", async () => {
    // BR-008: el registro federativo lo mantiene el Admin. Se exige el error y
    // no sólo que el valor no cambie: sin el `revoke` de `0003_members` el
    // update afectaría a cero filas y saldría en verde, y el cliente creería
    // que guardó.
    const database = await migratedDatabase();
    const insercion = await insertMember(database);
    expect(insercion.code, insercion.stderr).toBe(0);
    const userId = await database.query("select user_id from public.members");

    const intento = await database.attempt(
      `set role authenticated; set request.jwt.claims = '{"sub":"${userId}"}';
       update public.members set auf_number = 'AUF-00001'`,
    );

    expect(intento.code).toBeGreaterThan(0);
    expect(intento.stderr).toMatch(/permission denied for (table|column)/);
  });

  it("sigue sin dar a anon ningún privilegio sobre la tabla", async () => {
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
