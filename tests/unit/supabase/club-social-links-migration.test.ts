import { expect, it } from "vitest";
import {
  applyRepositoryMigrations,
  describeConPostgres,
  migratedDatabase,
  type TemporaryDatabase,
} from "../../support/postgres";

/**
 * `0091_club_social_links.sql` contra un Postgres desechable (#963, RF-1 del
 * PRD de E37). Un enlace por red, de una de las seis redes y de 1 a 300
 * caracteres. Los lee cualquiera, porque son públicas, y sólo los escribe la
 * llave de servicio.
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

function insertLink(clubId: string, network: string, url: string): string {
  return `insert into public.club_social_links (club_id, network, url)
          values ('${clubId}', '${network}', ${url})`;
}

describeConPostgres("las redes del club en la base", () => {
  it("guarda un enlace por cada una de las seis redes", async () => {
    const database = await migratedDatabase();
    const clubId = await clubIdOf(database);
    const networks = [
      "instagram",
      "tiktok",
      "youtube",
      "facebook",
      "whatsapp",
      "website",
    ];

    const writing = await database.attempt(
      asRole(
        "service_role",
        networks
          .map((network) =>
            insertLink(clubId, network, `'https://example.com/${network}'`),
          )
          .join("; "),
      ),
    );

    expect(writing.code, writing.stderr).toBe(0);
    expect(
      await database.query("select count(*) from public.club_social_links"),
    ).toBe("6");
  });

  it("rechaza una red que no es de las seis", async () => {
    const database = await migratedDatabase();
    const clubId = await clubIdOf(database);

    const writing = await database.attempt(
      insertLink(clubId, "myspace", "'https://myspace.com/x'"),
    );

    expect(writing.stderr).toMatch(/club_social_links_network_check/);
  });

  it("no deja dos enlaces de la misma red en un club", async () => {
    const database = await migratedDatabase();
    const clubId = await clubIdOf(database);
    await database.query(
      insertLink(clubId, "instagram", "'https://instagram.com/a'"),
    );

    const writing = await database.attempt(
      insertLink(clubId, "instagram", "'https://instagram.com/b'"),
    );

    expect(writing.stderr).toMatch(/club_social_links_pkey/);
  });

  it.each([
    ["un enlace de 301 caracteres", "repeat('a', 301)"],
    ["un enlace de sólo espacios", "'   '"],
  ])("rechaza %s", async (_case, url) => {
    const database = await migratedDatabase();
    const clubId = await clubIdOf(database);

    const writing = await database.attempt(insertLink(clubId, "website", url));

    expect(writing.stderr).toMatch(/club_social_links_url_length/);
  });

  it("acepta un enlace de 300 caracteres", async () => {
    const database = await migratedDatabase();
    const clubId = await clubIdOf(database);

    const writing = await database.attempt(
      insertLink(clubId, "website", "repeat('a', 300)"),
    );

    expect(writing.code, writing.stderr).toBe(0);
  });

  it.each(["anon", "authenticated"] as const)(
    "deja a %s leerlas, porque son públicas",
    async (role) => {
      const database = await migratedDatabase();
      const clubId = await clubIdOf(database);
      await database.query(
        insertLink(clubId, "youtube", "'https://youtu.be/abc'"),
      );

      const reading = await database.attempt(
        asRole(role, "select url from public.club_social_links"),
      );

      expect(reading.code, reading.stderr).toBe(0);
      expect(reading.stdout.trim()).toBe("https://youtu.be/abc");
    },
  );

  it.each([
    ["anon", "insert"],
    ["authenticated", "insert"],
    ["authenticated", "update"],
    ["authenticated", "delete"],
  ] as const)("no deja a %s escribirlas (%s)", async (role, verb) => {
    const database = await migratedDatabase();
    const clubId = await clubIdOf(database);
    const statements = {
      insert: insertLink(clubId, "instagram", "'https://evil.example'"),
      update:
        "update public.club_social_links set url = 'https://evil.example'",
      delete: "delete from public.club_social_links",
    };

    const writing = await database.attempt(asRole(role, statements[verb]));

    expect(writing.code).toBeGreaterThan(0);
    expect(writing.stderr).toMatch(
      /permission denied for table club_social_links/,
    );
  });

  it("se van con el club que se borra", async () => {
    const database = await migratedDatabase();
    const clubId = await database.query(
      `insert into public.clubs (slug, name) values ('otro-club', 'Otro Club')
       returning id`,
    );
    await database.query(
      insertLink(clubId, "website", "'https://otro.example'"),
    );

    await database.query(`delete from public.clubs where id = '${clubId}'`);

    expect(
      await database.query("select count(*) from public.club_social_links"),
    ).toBe("0");
  });

  it("aplicada dos veces no falla ni borra lo que el club guardó", async () => {
    const database = await migratedDatabase();
    const clubId = await clubIdOf(database);
    await database.query(
      insertLink(clubId, "website", "'https://seadragons.example'"),
    );

    const second = await applyRepositoryMigrations(database);

    expect(second.code, second.stderr).toBe(0);
    expect(
      await database.query("select url from public.club_social_links"),
    ).toBe("https://seadragons.example");
  });
});
