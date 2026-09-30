import { expect, it } from "vitest";
import {
  type TemporaryDatabase,
  applyRepositoryMigrations,
  describeConPostgres,
  migratedDatabase,
} from "../../support/postgres";

/**
 * `0049_search.sql` contra un Postgres desechable (#425, RF-7 y D5 del PRD
 * de E14). La búsqueda global coincide por subcadena sin mayúsculas ni
 * acentos, y el texto que escribe el socio se busca tal cual: un `%` o un
 * `_` son letras, no comodines.
 *
 * Los acentos van como escapes `U&'...'`: psql en Windows no pasa bien un
 * argumento con tildes, y así el test prueba lo mismo en las dos máquinas.
 */

const SEEDED_CLUB = "victoria-seadragons";
const MUNOZ = "U&'Luc\\00EDa Mu\\00F1oz'";

type Member = { readonly clubId: string; readonly userId: string };

function seededClubId(database: TemporaryDatabase): Promise<string> {
  return database.query(
    `select id from public.clubs where slug = '${SEEDED_CLUB}'`,
  );
}

function seedOtherClub(database: TemporaryDatabase): Promise<string> {
  return database.query(
    `insert into public.clubs (name, slug)
     values ('Otro club', 'otro-club') returning id`,
  );
}

/** `fullNameSql` es una expresión SQL, para poder pasar escapes Unicode. */
async function seedMember(
  database: TemporaryDatabase,
  clubId: string,
  fullNameSql: string,
): Promise<Member> {
  const userId = await database.query(
    "insert into auth.users (id) values (gen_random_uuid()) returning id",
  );
  await database.query(
    `insert into public.members
       (club_id, user_id, full_name, email, account_status)
     values ('${clubId}', '${userId}', ${fullNameSql},
             '${userId}@example.test', 'active')`,
  );
  return { clubId, userId };
}

function seedEvent(
  database: TemporaryDatabase,
  author: Member,
  place: { readonly title: string; readonly location: string },
): Promise<string> {
  return database.query(
    `insert into public.events
       (club_id, title, event_type, starts_on, start_time, location,
        audience, author_id)
     values ('${author.clubId}', '${place.title}', 'training', '2027-07-06',
             '19:00', '${place.location}', 'all', '${author.userId}')
     returning id`,
  );
}

function seedNewsPost(
  database: TemporaryDatabase,
  author: Member,
  content: { readonly title: string; readonly body: string },
): Promise<string> {
  return database.query(
    `insert into public.news_posts
       (club_id, category, title, body, author_id, audience)
     values ('${author.clubId}', 'news', '${content.title}',
             '${content.body}', '${author.userId}', 'club')
     returning id`,
  );
}

/** Los nombres que devuelve `search_members`, en orden alfabético. */
function searchMemberNames(
  database: TemporaryDatabase,
  clubId: string,
  textSql: string,
): Promise<string> {
  return database.query(
    `set role service_role;
     select coalesce(string_agg(
              public.search_normalize(full_name), ',' order by full_name), '')
       from public.search_members('${clubId}', ${textSql})`,
  );
}

describeConPostgres("la búsqueda global en la base", () => {
  it("instala unaccent y pg_trgm", async () => {
    const database = await migratedDatabase();

    const extensions = await database.query(
      `select string_agg(extname, ',' order by extname)
         from pg_extension
        where extname in ('unaccent', 'pg_trgm')`,
    );

    expect(extensions).toBe("pg_trgm,unaccent");
  });

  it("normaliza sin mayúsculas ni acentos", async () => {
    const database = await migratedDatabase();

    const normalized = await database.query(
      `select public.search_normalize(U&'PISCINA de Mu\\00D1OZ \\00C1vila')`,
    );

    expect(normalized).toBe("piscina de munoz avila");
  });

  it("la normalización es immutable, para poder indexarla", async () => {
    const database = await migratedDatabase();

    const volatility = await database.query(
      `select string_agg(proname || '=' || provolatile::text, ',' order by proname)
         from pg_proc
        where pronamespace = 'public'::regnamespace
          and proname in ('immutable_unaccent', 'search_normalize')`,
    );

    expect(volatility).toBe("immutable_unaccent=i,search_normalize=i");
  });

  it("'munoz' encuentra a Muñoz y 'LUCIA' también", async () => {
    const database = await migratedDatabase();
    const clubId = await seededClubId(database);
    await seedMember(database, clubId, MUNOZ);
    await seedMember(database, clubId, "'Ana Gil'");

    await expect(searchMemberNames(database, clubId, "'munoz'")).resolves.toBe(
      "lucia munoz",
    );
    await expect(searchMemberNames(database, clubId, "'LUCIA'")).resolves.toBe(
      "lucia munoz",
    );
  });

  it("un texto con acentos encuentra el nombre sin ellos", async () => {
    const database = await migratedDatabase();
    const clubId = await seededClubId(database);
    await seedMember(database, clubId, "'Ana Gil'");

    await expect(
      searchMemberNames(database, clubId, "U&'\\00C1na'"),
    ).resolves.toBe("ana gil");
  });

  it("sólo busca socios del club que se le pide", async () => {
    const database = await migratedDatabase();
    const clubId = await seededClubId(database);
    const otherClubId = await seedOtherClub(database);
    await seedMember(database, otherClubId, MUNOZ);

    await expect(searchMemberNames(database, clubId, "'munoz'")).resolves.toBe(
      "",
    );
  });

  it("'%' y '_' se buscan como letras, no como comodines", async () => {
    const database = await migratedDatabase();
    const clubId = await seededClubId(database);
    await seedMember(database, clubId, "'Rebaja 50% Perez'");
    await seedMember(database, clubId, "'Mar_ta'");
    await seedMember(database, clubId, "'Ana Gil'");

    await expect(searchMemberNames(database, clubId, "'%'")).resolves.toBe(
      "rebaja 50% perez",
    );
    await expect(searchMemberNames(database, clubId, "'_'")).resolves.toBe(
      "mar_ta",
    );
  });

  it("una contrabarra y una comilla también son letras", async () => {
    const database = await migratedDatabase();
    const clubId = await seededClubId(database);
    await seedMember(database, clubId, "'Sean O''Neil'");
    await seedMember(database, clubId, "E'Barra\\\\Invertida'");
    await seedMember(database, clubId, "'Ana Gil'");

    await expect(searchMemberNames(database, clubId, "'o''n'")).resolves.toBe(
      "sean o'neil",
    );
    await expect(searchMemberNames(database, clubId, "E'\\\\'")).resolves.toBe(
      "barra\\invertida",
    );
  });

  it("encuentra eventos por título o por lugar, por subcadena", async () => {
    const database = await migratedDatabase();
    const clubId = await seededClubId(database);
    const author = await seedMember(database, clubId, "'Ana Gil'");
    await seedEvent(database, author, {
      title: "Scrimmage vs Geelong",
      location: "MSAC",
    });
    await seedEvent(database, author, {
      title: "Entrenamiento",
      location: "Piscina Norte",
    });
    await seedEvent(database, author, { title: "Asamblea", location: "Sede" });

    const found = await database.query(
      `set role service_role;
       select string_agg(title, ',' order by title)
         from (
           select title from public.search_events('${clubId}', 'geelong')
           union all
           select title from public.search_events('${clubId}', 'isc')
         ) found`,
    );

    expect(found).toBe("Entrenamiento,Scrimmage vs Geelong");
  });

  it("encuentra noticias por título o por cuerpo", async () => {
    const database = await migratedDatabase();
    const clubId = await seededClubId(database);
    const author = await seedMember(database, clubId, "'Ana Gil'");
    await seedNewsPost(database, author, {
      title: "Viaje a Geelong",
      body: "Salimos el sabado.",
    });
    await seedNewsPost(database, author, {
      title: "Cuotas",
      body: "El torneo de GEELONG pide la cuota.",
    });
    await seedNewsPost(database, author, {
      title: "Asamblea",
      body: "Nada que ver.",
    });

    const found = await database.query(
      `set role service_role;
       select string_agg(title, ',' order by title)
         from public.search_news_posts('${clubId}', 'geelong')`,
    );

    expect(found).toBe("Cuotas,Viaje a Geelong");
  });

  it("indexa los campos que se buscan con trigramas", async () => {
    const database = await migratedDatabase();

    const indexes = await database.query(
      `select string_agg(indexname, ',' order by indexname)
         from pg_indexes
        where schemaname = 'public'
          and indexdef like '%gin_trgm_ops%'
          and indexdef like '%search_normalize%'`,
    );

    expect(indexes).toBe(
      [
        "events_location_search_idx",
        "events_title_search_idx",
        "members_full_name_search_idx",
        "news_posts_body_search_idx",
        "news_posts_title_search_idx",
      ].join(","),
    );
  });

  it("sólo el servidor ejecuta las búsquedas", async () => {
    const database = await migratedDatabase();

    const executable = await database.query(
      `select string_agg(
                p.proname || ' ' || r.rolname,
                ',' order by p.proname, r.rolname)
         from pg_proc p
         cross join (values ('anon'), ('authenticated'), ('service_role'))
           as r (rolname)
        where p.pronamespace = 'public'::regnamespace
          and p.proname in
            ('search_members', 'search_events', 'search_news_posts')
          and has_function_privilege(r.rolname, p.oid, 'execute')`,
    );

    expect(executable).toBe(
      [
        "search_events service_role",
        "search_members service_role",
        "search_news_posts service_role",
      ].join(","),
    );
  });

  it("es idempotente: aplicada dos veces no falla ni cambia nada", async () => {
    const database = await migratedDatabase();
    const afterFirst = await database.snapshot();

    const second = await applyRepositoryMigrations(database);

    expect(second.code, second.stderr).toBe(0);
    expect(afterFirst).toMatch(/funcion search_members/);
    expect(await database.snapshot()).toBe(afterFirst);
  });
});
