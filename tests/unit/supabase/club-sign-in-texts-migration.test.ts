import { expect, it } from "vitest";
import {
  applyRepositoryMigrations,
  describeConPostgres,
  migratedDatabase,
  type TemporaryDatabase,
} from "../../support/postgres";

/**
 * `0028_club_sign_in_texts.sql` contra un Postgres desechable (#301, RF-5 del
 * PRD de E18a). El lema y el párrafo del inicio de sesión, una fila por
 * idioma, con los límites de 140 y 320 caracteres. Los lee cualquiera, porque
 * la pantalla de entrar se sirve sin sesión, y sólo los escribe la llave de
 * servicio.
 */

const SEEDED_CLUB = "victoria-seadragons";

function asRole(
  role: "anon" | "authenticated" | "service_role",
  sql: string,
): string {
  return `set role ${role}; ${sql}`;
}

function clubIdOf(database: TemporaryDatabase): Promise<string> {
  return database.query(
    `select id from public.clubs where slug = '${SEEDED_CLUB}'`,
  );
}

function insertTexts(
  clubId: string,
  texts: { locale: string; tagline: string; welcome: string },
): string {
  return `insert into public.club_sign_in_texts
            (club_id, locale, tagline, welcome)
          values ('${clubId}', '${texts.locale}', ${texts.tagline},
                  ${texts.welcome})`;
}

describeConPostgres("los textos del inicio de sesión en la base", () => {
  it("guarda un lema y un párrafo por idioma, y deja uno sin texto", async () => {
    const database = await migratedDatabase();
    const clubId = await clubIdOf(database);

    const writing = await database.attempt(
      asRole(
        "service_role",
        `${insertTexts(clubId, {
          locale: "en",
          tagline: "'Dive in.'",
          welcome: "null",
        })}; ${insertTexts(clubId, {
          locale: "es",
          tagline: "'Al agua.'",
          welcome: "'Entrena con nosotros.'",
        })}`,
      ),
    );

    expect(writing.code, writing.stderr).toBe(0);
    expect(
      await database.query(
        `select string_agg(locale || '=' || coalesce(welcome, '-'), ','
                           order by locale)
           from public.club_sign_in_texts`,
      ),
    ).toBe("en=-,es=Entrena con nosotros.");
  });

  it.each([
    ["un lema de 141 caracteres", "repeat('a', 141)", "null"],
    ["un párrafo de 321 caracteres", "null", "repeat('b', 321)"],
    ["un lema de sólo espacios", "'   '", "null"],
  ])("rechaza %s", async (_case, tagline, welcome) => {
    const database = await migratedDatabase();
    const clubId = await clubIdOf(database);

    const writing = await database.attempt(
      insertTexts(clubId, { locale: "en", tagline, welcome }),
    );

    expect(writing.code).toBeGreaterThan(0);
    expect(writing.stderr).toMatch(/club_sign_in_texts_\w+_length/);
  });

  it("acepta un lema de 140 y un párrafo de 320", async () => {
    const database = await migratedDatabase();
    const clubId = await clubIdOf(database);

    const writing = await database.attempt(
      insertTexts(clubId, {
        locale: "en",
        tagline: "repeat('a', 140)",
        welcome: "repeat('b', 320)",
      }),
    );

    expect(writing.code, writing.stderr).toBe(0);
  });

  it("rechaza un idioma que la aplicación no habla", async () => {
    const database = await migratedDatabase();
    const clubId = await clubIdOf(database);

    const writing = await database.attempt(
      insertTexts(clubId, {
        locale: "fr",
        tagline: "'Plongez.'",
        welcome: "null",
      }),
    );

    expect(writing.stderr).toMatch(/club_sign_in_texts_locale_check/);
  });

  it("deja a anon leerlos, porque la pantalla de entrar no tiene sesión", async () => {
    const database = await migratedDatabase();
    const clubId = await clubIdOf(database);
    await database.query(
      insertTexts(clubId, {
        locale: "en",
        tagline: "'Dive in.'",
        welcome: "null",
      }),
    );

    const reading = await database.attempt(
      asRole("anon", "select tagline from public.club_sign_in_texts"),
    );

    expect(reading.code, reading.stderr).toBe(0);
    expect(reading.stdout.trim()).toBe("Dive in.");
  });

  it.each([
    ["anon", "insert"],
    ["authenticated", "insert"],
    ["authenticated", "update"],
    ["authenticated", "delete"],
  ] as const)("no deja a %s escribirlos (%s)", async (role, verb) => {
    const database = await migratedDatabase();
    const clubId = await clubIdOf(database);
    const statements = {
      insert: insertTexts(clubId, {
        locale: "en",
        tagline: "'Hacked'",
        welcome: "null",
      }),
      update: "update public.club_sign_in_texts set tagline = 'Hacked'",
      delete: "delete from public.club_sign_in_texts",
    };

    const writing = await database.attempt(asRole(role, statements[verb]));

    expect(writing.code).toBeGreaterThan(0);
    expect(writing.stderr).toMatch(
      /permission denied for table club_sign_in_texts/,
    );
  });

  it("se van con el club que se borra", async () => {
    const database = await migratedDatabase();
    const clubId = await database.query(
      `insert into public.clubs (slug, name) values ('otro-club', 'Otro Club')
       returning id`,
    );
    await database.query(
      insertTexts(clubId, { locale: "es", tagline: "'Hola'", welcome: "null" }),
    );

    await database.query(`delete from public.clubs where id = '${clubId}'`);

    expect(
      await database.query("select count(*) from public.club_sign_in_texts"),
    ).toBe("0");
  });

  it("aplicada dos veces no falla ni borra lo que el club escribió", async () => {
    const database = await migratedDatabase();
    const clubId = await clubIdOf(database);
    await database.query(
      insertTexts(clubId, { locale: "es", tagline: "'Hola'", welcome: "null" }),
    );

    const second = await applyRepositoryMigrations(database);

    expect(second.code, second.stderr).toBe(0);
    expect(
      await database.query("select tagline from public.club_sign_in_texts"),
    ).toBe("Hola");
  });
});
