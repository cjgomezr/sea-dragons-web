import { expect, it } from "vitest";
import {
  type RunResult,
  type TemporaryDatabase,
  applyRepositoryMigrations,
  describeConPostgres,
  migratedDatabase,
} from "../../support/postgres";

/**
 * `0065_news_inline_images.sql` contra un Postgres desechable (#603, RF-14
 * del PRD de E22). Cada imagen del cuerpo es una fila de
 * `news_inline_images`, que nace sin publicación y se liga a una al
 * guardarla; sólo la toca el servidor.
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

function insertImage(
  database: TemporaryDatabase,
  club: SeededClub,
): Promise<string> {
  return database.query(
    `insert into public.news_inline_images (id, club_id, uploaded_by)
     values (gen_random_uuid(), '${club.clubId}', '${club.committeeId}')
     returning id`,
  );
}

function linkImage(
  database: TemporaryDatabase,
  imageId: string,
  postId: string,
): Promise<RunResult> {
  return database.attempt(
    `update public.news_inline_images set post_id = '${postId}'
      where id = '${imageId}'`,
  );
}

/** La última línea de la salida: antes van las etiquetas de los `set`. */
function lastLine(output: string): string | undefined {
  return output.trim().split(/\r?\n/).at(-1);
}

describeConPostgres("las imágenes del cuerpo de las publicaciones", () => {
  it("la imagen nace sin publicación", async () => {
    const database = await migratedDatabase();
    const club = await seedClub(database);
    const imageId = await insertImage(database, club);

    const postId = await database.query(
      `select coalesce(post_id::text, 'null')
         from public.news_inline_images where id = '${imageId}'`,
    );

    expect(postId).toBe("null");
  });

  it("se liga a una publicación de su club", async () => {
    const database = await migratedDatabase();
    const club = await seedClub(database);
    const imageId = await insertImage(database, club);
    const postId = await insertPost(database, club);

    const link = await linkImage(database, imageId, postId);

    expect(link.code, link.stderr).toBe(0);
  });

  it("no se liga a una publicación que no existe", async () => {
    const database = await migratedDatabase();
    const club = await seedClub(database);
    const imageId = await insertImage(database, club);

    const link = await linkImage(
      database,
      imageId,
      "00000000-0000-4000-8000-000000000000",
    );

    expect(link.code).not.toBe(0);
    expect(link.stderr).toMatch(/news_inline_images_post_same_club_fkey/);
  });

  it("borrar la publicación deja la imagen sin publicación y en su club", async () => {
    const database = await migratedDatabase();
    const club = await seedClub(database);
    const imageId = await insertImage(database, club);
    const postId = await insertPost(database, club);
    await linkImage(database, imageId, postId);

    await database.query(
      `delete from public.news_posts where id = '${postId}'`,
    );

    const row = await database.query(
      `select coalesce(post_id::text, 'null') || ' ' || club_id
         from public.news_inline_images where id = '${imageId}'`,
    );
    expect(row).toBe(`null ${club.clubId}`);
  });

  it("no deja a un socio leer las imágenes con su sesión", async () => {
    const database = await migratedDatabase();
    const club = await seedClub(database);
    await insertImage(database, club);

    const read = await database.attempt(
      `set role authenticated;
       set request.jwt.claims = '{"sub":"${club.committeeId}"}';
       select count(*) from public.news_inline_images`,
    );

    expect(read.code).not.toBe(0);
    expect(read.stderr).toMatch(/permission denied/);
  });

  it("no deja a un socio leer el fichero de una imagen con su sesión", async () => {
    const database = await migratedDatabase();
    const club = await seedClub(database);
    await database.query(
      `insert into storage.objects (bucket_id, name)
       values ('news-attachments', '${club.clubId}/inline-images/foto.webp')`,
    );

    const read = await database.attempt(
      `set role authenticated;
       set request.jwt.claims = '{"sub":"${club.committeeId}"}';
       select count(*) from storage.objects where name like '%/inline-images/%'`,
    );

    expect(lastLine(read.stdout)).toBe("0");
  });

  it("aplicada dos veces no falla", async () => {
    const database = await migratedDatabase();

    const again = await applyRepositoryMigrations(database);

    expect(again.code, again.stderr).toBe(0);
  });
});
