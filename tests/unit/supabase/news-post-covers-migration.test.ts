import { expect, it } from "vitest";
import {
  type RunResult,
  type TemporaryDatabase,
  applyRepositoryMigrations,
  describeConPostgres,
  migratedDatabase,
} from "../../support/postgres";

/**
 * `0063_news_post_covers.sql` contra un Postgres desechable (#591, RF-2 del
 * PRD de E22). La portada es una fila de `news_cover_uploads` que la
 * publicación apunta; sólo la toca el servidor.
 */

type SeededClub = {
  readonly clubId: string;
  readonly committeeId: string;
};

async function seedClub(database: TemporaryDatabase): Promise<SeededClub> {
  const clubId = await database.query(
    "select id from public.clubs where slug = 'victoria-seadragons'",
  );
  const committeeId = await database.query(
    "insert into auth.users (id) values (gen_random_uuid()) returning id",
  );
  await database.query(
    `insert into public.members
       (club_id, user_id, full_name, email, account_status, role)
     values ('${clubId}', '${committeeId}', 'Carla Committee',
             '${committeeId}@example.test', 'active', 'Committee')`,
  );
  return { clubId, committeeId };
}

function insertCover(
  database: TemporaryDatabase,
  club: SeededClub,
): Promise<string> {
  return database.query(
    `insert into public.news_cover_uploads (id, club_id, uploaded_by)
     values (gen_random_uuid(), '${club.clubId}', '${club.committeeId}')
     returning id`,
  );
}

function insertPost(
  database: TemporaryDatabase,
  club: SeededClub,
  coverId: string,
): Promise<RunResult> {
  return database.attempt(
    `insert into public.news_posts
       (club_id, category, title, body, author_id, audience, cover_upload_id)
     values ('${club.clubId}', 'news', 'Crónica', 'Ganamos.',
             '${club.committeeId}', 'club', '${coverId}')`,
  );
}

/** La última línea de la salida: antes van las etiquetas de los `set`. */
function lastLine(output: string): string | undefined {
  return output.trim().split(/\r?\n/).at(-1);
}

describeConPostgres("la portada de las publicaciones", () => {
  it("añade cover_upload_id a news_posts, nula y sin valor por defecto", async () => {
    const database = await migratedDatabase();

    const column = await database.query(
      `select data_type || ' null=' || is_nullable || ' default='
              || coalesce(column_default, '-')
         from information_schema.columns
        where table_schema = 'public'
          and table_name = 'news_posts'
          and column_name = 'cover_upload_id'`,
    );

    expect(column).toBe("uuid null=YES default=-");
  });

  it("enlaza una publicación con una portada de su club", async () => {
    const database = await migratedDatabase();
    const club = await seedClub(database);
    const coverId = await insertCover(database, club);

    const insert = await insertPost(database, club, coverId);

    expect(insert.code, insert.stderr).toBe(0);
  });

  it("rechaza una portada que no existe", async () => {
    const database = await migratedDatabase();
    const club = await seedClub(database);

    const insert = await insertPost(
      database,
      club,
      "00000000-0000-4000-8000-000000000000",
    );

    expect(insert.code).not.toBe(0);
    expect(insert.stderr).toMatch(/news_posts_cover_same_club_fkey/);
  });

  it("no deja que dos publicaciones compartan portada", async () => {
    const database = await migratedDatabase();
    const club = await seedClub(database);
    const coverId = await insertCover(database, club);
    await insertPost(database, club, coverId);

    const second = await insertPost(database, club, coverId);

    expect(second.code).not.toBe(0);
    expect(second.stderr).toMatch(/news_posts_cover_upload_id_key/);
  });

  it("no deja borrar la portada que una publicación apunta", async () => {
    const database = await migratedDatabase();
    const club = await seedClub(database);
    const coverId = await insertCover(database, club);
    await insertPost(database, club, coverId);

    const removal = await database.attempt(
      `delete from public.news_cover_uploads where id = '${coverId}'`,
    );

    expect(removal.code).not.toBe(0);
    expect(removal.stderr).toMatch(/news_posts_cover_same_club_fkey/);
  });

  it("no deja a un socio leer las portadas con su sesión", async () => {
    const database = await migratedDatabase();
    const club = await seedClub(database);
    await insertCover(database, club);

    const read = await database.attempt(
      `set role authenticated;
       set request.jwt.claims = '{"sub":"${club.committeeId}"}';
       select count(*) from public.news_cover_uploads`,
    );

    expect(read.code).not.toBe(0);
    expect(read.stderr).toMatch(/permission denied/);
  });

  it("no deja a un socio leer el fichero de una portada con su sesión", async () => {
    const database = await migratedDatabase();
    const club = await seedClub(database);
    await database.query(
      `insert into storage.objects (bucket_id, name)
       values ('news-attachments', '${club.clubId}/covers/portada-large.webp')`,
    );

    const read = await database.attempt(
      `set role authenticated;
       set request.jwt.claims = '{"sub":"${club.committeeId}"}';
       select count(*) from storage.objects where name like '%/covers/%'`,
    );

    expect(lastLine(read.stdout)).toBe("0");
  });

  it("aplicada dos veces no falla", async () => {
    const database = await migratedDatabase();

    const again = await applyRepositoryMigrations(database);

    expect(again.code, again.stderr).toBe(0);
  });
});
