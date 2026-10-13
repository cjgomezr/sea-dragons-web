import { expect, it } from "vitest";
import {
  type TemporaryDatabase,
  applyRepositoryMigrations,
  describeConPostgres,
  migratedDatabase,
} from "../../support/postgres";

/**
 * `0064_news_post_pins.sql` contra un Postgres desechable (#592, RF-3 del
 * PRD de E22). Una sola fijada por club, que lo garantiza un índice único
 * parcial; fijar y desfijar van por dos funciones que comprueban al Admin
 * dentro, y retirar desfija (D8).
 */

type SeededClub = {
  readonly clubId: string;
  readonly adminId: string;
  readonly committeeId: string;
};

async function seedMember(
  database: TemporaryDatabase,
  clubId: string,
  role: "Admin" | "Committee",
): Promise<string> {
  const userId = await database.query(
    "insert into auth.users (id) values (gen_random_uuid()) returning id",
  );
  await database.query(
    `insert into public.members
       (club_id, user_id, full_name, email, account_status, role)
     values ('${clubId}', '${userId}', '${role} de prueba',
             '${userId}@example.test', 'active', '${role}')`,
  );
  return userId;
}

async function seedClub(database: TemporaryDatabase): Promise<SeededClub> {
  const clubId = await database.query(
    "select id from public.clubs where slug = 'victoria-seadragons'",
  );
  return {
    clubId,
    adminId: await seedMember(database, clubId, "Admin"),
    committeeId: await seedMember(database, clubId, "Committee"),
  };
}

function insertPost(
  database: TemporaryDatabase,
  club: SeededClub,
): Promise<string> {
  return database.query(
    `insert into public.news_posts
       (club_id, category, title, body, author_id, audience)
     values ('${club.clubId}', 'news', 'Crónica', 'Ganamos.',
             '${club.committeeId}', 'club')
     returning id`,
  );
}

function pin(
  club: SeededClub,
  postId: string,
  options: { readonly as?: string; readonly until?: string } = {},
): string {
  const until = options.until === undefined ? "null" : `'${options.until}'`;
  return `select public.pin_news_post('${club.clubId}',
            '${options.as ?? club.adminId}', '${postId}', ${until}) ->> 'outcome'`;
}

function unpin(
  club: SeededClub,
  postId: string,
  as: string = club.adminId,
): string {
  return `select public.unpin_news_post('${club.clubId}', '${as}',
            '${postId}') ->> 'outcome'`;
}

function pinnedIds(
  database: TemporaryDatabase,
  club: SeededClub,
): Promise<string> {
  return database.query(
    `select coalesce(string_agg(id::text, ',' order by id), '')
       from public.news_posts
      where club_id = '${club.clubId}' and pinned_at is not null`,
  );
}

/** La última línea de la salida: antes van las etiquetas de los `set`. */
function lastLine(output: string): string | undefined {
  return output.trim().split(/\r?\n/).at(-1);
}

describeConPostgres("fijar una publicación", () => {
  it("añade pinned_at y pinned_until a news_posts, nulas", async () => {
    const database = await migratedDatabase();

    const columns = await database.query(
      `select string_agg(column_name || ' ' || data_type || ' null='
                         || is_nullable, ', ' order by column_name)
         from information_schema.columns
        where table_schema = 'public'
          and table_name = 'news_posts'
          and column_name in ('pinned_at', 'pinned_until')`,
    );

    expect(columns).toBe(
      "pinned_at timestamp with time zone null=YES, " +
        "pinned_until timestamp with time zone null=YES",
    );
  });

  it("no deja dos publicaciones fijadas en el mismo club aunque se escriban a mano", async () => {
    const database = await migratedDatabase();
    const club = await seedClub(database);
    const first = await insertPost(database, club);
    const second = await insertPost(database, club);
    await database.query(
      `update public.news_posts set pinned_at = now() where id = '${first}'`,
    );

    const update = await database.attempt(
      `update public.news_posts set pinned_at = now() where id = '${second}'`,
    );

    expect(update.code).not.toBe(0);
    expect(update.stderr).toMatch(/news_posts_one_pinned_per_club/);
  });

  it("fija sin fecha de fin o hasta una fecha, y fijar otra desfija la anterior", async () => {
    const database = await migratedDatabase();
    const club = await seedClub(database);
    const first = await insertPost(database, club);
    const second = await insertPost(database, club);

    const pinnedFirst = await database.query(pin(club, first));
    const pinnedSecond = await database.query(
      pin(club, second, { until: "2999-01-01T00:00:00Z" }),
    );

    expect([pinnedFirst, pinnedSecond]).toEqual(["pinned", "pinned"]);
    await expect(pinnedIds(database, club)).resolves.toBe(second);
    await expect(
      database.query(
        `select pinned_until = '2999-01-01T00:00:00Z'
           from public.news_posts where id = '${second}'`,
      ),
    ).resolves.toBe("t");
  });

  it("dice quién era la fijada que reemplaza", async () => {
    const database = await migratedDatabase();
    const club = await seedClub(database);
    const first = await insertPost(database, club);
    const second = await insertPost(database, club);
    await database.query(pin(club, first));

    const replaced = await database.query(
      `select public.pin_news_post('${club.clubId}', '${club.adminId}',
                '${second}', null) ->> 'replaced_post_id'`,
    );

    expect(replaced).toBe(first);
  });

  it("con dos fijados a la vez sobre publicaciones distintas queda una sola", async () => {
    const database = await migratedDatabase();
    const club = await seedClub(database);
    const first = await insertPost(database, club);
    const second = await insertPost(database, club);

    const [slow, fast] = await Promise.all([
      database.attempt(
        `begin; ${pin(club, first)}; select pg_sleep(1); commit;`,
      ),
      new Promise((resolve) => setTimeout(resolve, 300)).then(() =>
        database.attempt(pin(club, second)),
      ),
    ]);

    expect(slow.code, slow.stderr).toBe(0);
    expect(fast.code, fast.stderr).toBe(0);
    await expect(pinnedIds(database, club)).resolves.toBe(second);
  });

  it("no deja fijar ni desfijar a quien no es Admin", async () => {
    const database = await migratedDatabase();
    const club = await seedClub(database);
    const post = await insertPost(database, club);

    const pinned = await database.query(
      pin(club, post, { as: club.committeeId }),
    );
    await database.query(pin(club, post));
    const unpinned = await database.query(unpin(club, post, club.committeeId));

    expect([pinned, unpinned]).toEqual(["forbidden", "forbidden"]);
    await expect(pinnedIds(database, club)).resolves.toBe(post);
  });

  it("no fija una retirada, ni con una fecha de fin ya pasada", async () => {
    const database = await migratedDatabase();
    const club = await seedClub(database);
    const post = await insertPost(database, club);
    const withdrawn = await insertPost(database, club);
    await database.query(
      `update public.news_posts set status = 'withdrawn'
        where id = '${withdrawn}'`,
    );

    const outcomes = [
      await database.query(pin(club, withdrawn)),
      await database.query(pin(club, post, { until: "2000-01-01T00:00:00Z" })),
    ];

    expect(outcomes).toEqual(["withdrawn", "invalid_until"]);
    await expect(pinnedIds(database, club)).resolves.toBe("");
  });

  it("desfija, y desfijar la que no está fijada no es un error", async () => {
    const database = await migratedDatabase();
    const club = await seedClub(database);
    const post = await insertPost(database, club);
    await database.query(pin(club, post));

    const outcomes = [
      await database.query(unpin(club, post)),
      await database.query(unpin(club, post)),
    ];

    expect(outcomes).toEqual(["unpinned", "not_pinned"]);
    await expect(pinnedIds(database, club)).resolves.toBe("");
  });

  it("retirar la fijada la desfija, y volver a publicarla no la refija", async () => {
    const database = await migratedDatabase();
    const club = await seedClub(database);
    const post = await insertPost(database, club);
    await database.query(pin(club, post));

    await database.query(
      `update public.news_posts set status = 'withdrawn' where id = '${post}'`,
    );
    await database.query(
      `update public.news_posts set status = 'published' where id = '${post}'`,
    );

    await expect(
      database.query(
        `select (pinned_at is null and pinned_until is null)::text
           from public.news_posts where id = '${post}'`,
      ),
    ).resolves.toBe("true");
  });

  it("no deja a un socio llamar a las funciones de fijar con su sesión", async () => {
    const database = await migratedDatabase();
    const club = await seedClub(database);
    const post = await insertPost(database, club);

    const call = await database.attempt(
      `set role authenticated;
       set request.jwt.claims = '{"sub":"${club.adminId}"}';
       ${pin(club, post)}`,
    );

    expect(call.code).not.toBe(0);
    expect(call.stderr).toMatch(/permission denied/);
  });

  it("no deja a un socio escribir las columnas del fijado con su sesión", async () => {
    const database = await migratedDatabase();
    const club = await seedClub(database);
    const post = await insertPost(database, club);

    const write = await database.attempt(
      `set role authenticated;
       set request.jwt.claims = '{"sub":"${club.committeeId}"}';
       update public.news_posts set pinned_at = now() where id = '${post}'`,
    );

    expect(write.code).not.toBe(0);
    expect(lastLine(write.stderr)).toMatch(/permission denied/);
  });

  it("aplicada dos veces no falla", async () => {
    const database = await migratedDatabase();

    const again = await applyRepositoryMigrations(database);

    expect(again.code, again.stderr).toBe(0);
  });
});
