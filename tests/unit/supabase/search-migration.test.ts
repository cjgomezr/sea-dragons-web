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

function seedGroup(
  database: TemporaryDatabase,
  clubId: string,
): Promise<string> {
  return database.query(
    `insert into public.groups (club_id, name)
     values ('${clubId}', 'Senior Squad ' || gen_random_uuid()) returning id`,
  );
}

/** Sin `groupId` va a todo el club; con él, sólo a ese grupo. */
async function seedEvent(
  database: TemporaryDatabase,
  author: Member,
  event: {
    readonly title: string;
    readonly location: string;
    readonly groupId?: string;
  },
): Promise<string> {
  const audience = event.groupId === undefined ? "all" : "groups";
  const eventId = await database.query(
    `insert into public.events
       (club_id, title, event_type, starts_on, start_time, location,
        audience, author_id)
     values ('${author.clubId}', '${event.title}', 'training', '2027-07-06',
             '19:00', '${event.location}', '${audience}', '${author.userId}')
     returning id`,
  );
  if (event.groupId !== undefined) {
    await database.query(
      `insert into public.event_groups (event_id, group_id, club_id)
       values ('${eventId}', '${event.groupId}', '${author.clubId}')`,
    );
  }
  return eventId;
}

/** Sin `groupId` va a todo el club; con él, sólo a ese grupo. */
async function seedNewsPost(
  database: TemporaryDatabase,
  author: Member,
  post: {
    readonly title: string;
    readonly body: string;
    readonly groupId?: string;
    readonly status?: "published" | "withdrawn";
  },
): Promise<string> {
  const audience = post.groupId === undefined ? "club" : "groups";
  const postId = await database.query(
    `insert into public.news_posts
       (club_id, category, title, body, author_id, audience, status)
     values ('${author.clubId}', 'news', '${post.title}', '${post.body}',
             '${author.userId}', '${audience}',
             '${post.status ?? "published"}')
     returning id`,
  );
  if (post.groupId !== undefined) {
    await database.query(
      `insert into public.news_post_groups (post_id, group_id, club_id)
       values ('${postId}', '${post.groupId}', '${author.clubId}')`,
    );
  }
  return postId;
}

function uuidArray(ids: readonly string[]): string {
  return `array[${ids.map((id) => `'${id}'`).join(",")}]::uuid[]`;
}

/** Los títulos que devuelve `search_events`, en orden alfabético. */
function searchEventTitles(
  database: TemporaryDatabase,
  clubId: string,
  search: {
    readonly text: string;
    readonly wholeClub: boolean;
    readonly groupIds: readonly string[];
  },
): Promise<string> {
  return database.query(
    `set role service_role;
     select coalesce(string_agg(title, ',' order by title), '')
       from public.search_events('${clubId}', '${search.text}',
                                 ${search.wholeClub},
                                 ${uuidArray(search.groupIds)})`,
  );
}

/** Los títulos que devuelve `search_news_posts`, en orden alfabético. */
function searchNewsTitles(
  database: TemporaryDatabase,
  clubId: string,
  search: {
    readonly text: string;
    readonly readerId: string;
    readonly groupIds: readonly string[];
  },
): Promise<string> {
  return database.query(
    `set role service_role;
     select coalesce(string_agg(title, ',' order by title), '')
       from public.search_news_posts('${clubId}', '${search.text}',
                                     '${search.readerId}',
                                     ${uuidArray(search.groupIds)})`,
  );
}

/** El volumen de NFR-008. Uno de cada cien eventos y noticias habla de
 * Geelong, para que la búsqueda tenga algo que contar. */
const SCALE = { members: 500, events: 5000, news: 1000 } as const;
const ONE_SECOND_MS = 1000;

async function seedClubAtScale(
  database: TemporaryDatabase,
  clubId: string,
): Promise<void> {
  const author = await seedMember(database, clubId, "'Ana Gil'");
  await database.query(
    `with users as (
       insert into auth.users (id)
       select gen_random_uuid() from generate_series(1, ${SCALE.members})
       returning id
     )
     insert into public.members
       (club_id, user_id, full_name, email, account_status)
     select '${clubId}', id, 'Socio ' || row_number() over (),
            id || '@example.test', 'active'
       from users;
     insert into public.events
       (club_id, title, event_type, starts_on, start_time, location,
        audience, author_id)
     select '${clubId}',
            case when i % 100 = 0 then 'Scrimmage vs Geelong'
                 else 'Entrenamiento ' || i end,
            'training', current_date - 2500 + i, '19:00',
            'Piscina ' || (i % 20), 'all', '${author.userId}'
       from generate_series(1, ${SCALE.events}) i;
     insert into public.news_posts
       (club_id, category, title, body, author_id, audience)
     select '${clubId}', 'news',
            case when i % 100 = 0 then 'Viaje a Geelong'
                 else 'Noticia ' || i end,
            'Cuerpo de la noticia ' || i, '${author.userId}', 'club'
       from generate_series(1, ${SCALE.news}) i;
     analyze public.members;
     analyze public.events;
     analyze public.news_posts;`,
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
    const wholeClub = { wholeClub: true, groupIds: [] };

    await expect(
      searchEventTitles(database, clubId, { ...wholeClub, text: "geelong" }),
    ).resolves.toBe("Scrimmage vs Geelong");
    await expect(
      searchEventTitles(database, clubId, { ...wholeClub, text: "isc" }),
    ).resolves.toBe("Entrenamiento");
  });

  it("un evento de un grupo sólo aparece a su grupo o a quien ve todo el club", async () => {
    const database = await migratedDatabase();
    const clubId = await seededClubId(database);
    const author = await seedMember(database, clubId, "'Ana Gil'");
    const squad = await seedGroup(database, clubId);
    const otherGroup = await seedGroup(database, clubId);
    await seedEvent(database, author, {
      title: "Geelong para todos",
      location: "MSAC",
    });
    await seedEvent(database, author, {
      title: "Geelong del grupo",
      location: "MSAC",
      groupId: squad,
    });
    const text = "geelong";

    await expect(
      searchEventTitles(database, clubId, {
        text,
        wholeClub: false,
        groupIds: [otherGroup],
      }),
    ).resolves.toBe("Geelong para todos");
    await expect(
      searchEventTitles(database, clubId, {
        text,
        wholeClub: false,
        groupIds: [squad],
      }),
    ).resolves.toBe("Geelong del grupo,Geelong para todos");
    await expect(
      searchEventTitles(database, clubId, {
        text,
        wholeClub: true,
        groupIds: [],
      }),
    ).resolves.toBe("Geelong del grupo,Geelong para todos");
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

    const found = await searchNewsTitles(database, clubId, {
      text: "geelong",
      readerId: author.userId,
      groupIds: [],
    });

    expect(found).toBe("Cuotas,Viaje a Geelong");
  });

  it("de las noticias, sigue las reglas del feed", async () => {
    const database = await migratedDatabase();
    const clubId = await seededClubId(database);
    const author = await seedMember(database, clubId, "'Ana Gil'");
    const reader = await seedMember(database, clubId, "'Leo Lector'");
    const squad = await seedGroup(database, clubId);
    const otherGroup = await seedGroup(database, clubId);
    await seedNewsPost(database, author, { title: "Geelong club", body: "x" });
    await seedNewsPost(database, author, {
      title: "Geelong grupo",
      body: "x",
      groupId: squad,
    });
    await seedNewsPost(database, author, {
      title: "Geelong retirada",
      body: "x",
      status: "withdrawn",
    });
    await seedNewsPost(database, author, {
      title: "Geelong ajena",
      body: "x",
      groupId: otherGroup,
    });
    const text = "geelong";

    await expect(
      searchNewsTitles(database, clubId, {
        text,
        readerId: reader.userId,
        groupIds: [squad],
      }),
    ).resolves.toBe("Geelong club,Geelong grupo");
    await expect(
      searchNewsTitles(database, clubId, {
        text,
        readerId: author.userId,
        groupIds: [],
      }),
    ).resolves.toBe(
      "Geelong ajena,Geelong club,Geelong grupo,Geelong retirada",
    );
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

  it("con 500 socios, 5.000 eventos y 1.000 noticias responde en menos de un segundo", async () => {
    const database = await migratedDatabase();
    const clubId = await seededClubId(database);
    await seedClubAtScale(database, clubId);
    const squad = await seedGroup(database, clubId);
    const reader = await seedMember(database, clubId, "'Leo Lector'");

    const started = performance.now();
    await database.query(
      `set role service_role;
       ${["geelong", "pi"]
         .map(
           (text) => `
       select count(*) from public.search_members('${clubId}', '${text}');
       select count(*), min(starts_at)
         from public.search_events('${clubId}', '${text}', false,
                                   array['${squad}']::uuid[])
        where starts_on >= current_date;
       select count(*), max(published_at)
         from public.search_news_posts('${clubId}', '${text}',
                                       '${reader.userId}',
                                       array['${squad}']::uuid[]);`,
         )
         .join("\n")}`,
    );
    const elapsedMs = performance.now() - started;

    // Incluye arrancar psql: el tiempo de la base es menor todavía.
    expect(elapsedMs).toBeLessThan(ONE_SECOND_MS);
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
