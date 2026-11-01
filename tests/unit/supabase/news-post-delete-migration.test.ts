import { expect, it } from "vitest";
import {
  type TemporaryDatabase,
  describeConPostgres,
  migratedDatabase,
} from "../../support/postgres";

/**
 * `0090_news_post_delete.sql` contra un Postgres desechable (#958): borrar
 * una publicación retirada se lleva su audiencia, sus adjuntos, su portada y
 * sus imágenes del cuerpo en una transacción, y devuelve lo que hace falta
 * para borrar sus ficheros. Una publicada no se borra.
 */

type SeededPost = {
  readonly clubId: string;
  readonly postId: string;
  readonly coverId: string;
  readonly imageId: string;
  readonly attachmentPath: string;
};

async function seedAuthor(
  database: TemporaryDatabase,
  clubId: string,
): Promise<string> {
  const userId = await database.query(
    "insert into auth.users (id) values (gen_random_uuid()) returning id",
  );
  await database.query(
    `insert into public.members
       (club_id, user_id, full_name, email, account_status, role)
     values ('${clubId}', '${userId}', 'Carla Committee',
             '${userId}@example.test', 'active', 'Committee')`,
  );
  return userId;
}

async function seedGroup(
  database: TemporaryDatabase,
  clubId: string,
): Promise<string> {
  return database.query(
    `insert into public.groups (club_id, name)
     values ('${clubId}', 'Senior ' || gen_random_uuid())
     returning id`,
  );
}

/** Una publicación a un grupo, con un adjunto, su portada y una imagen en el
 * cuerpo, en el estado que se pida. */
async function seedPost(
  database: TemporaryDatabase,
  status: "published" | "withdrawn",
): Promise<SeededPost> {
  const clubId = await database.query(
    "select id from public.clubs where slug = 'victoria-seadragons'",
  );
  const authorId = await seedAuthor(database, clubId);
  const groupId = await seedGroup(database, clubId);
  const coverId = await database.query(
    `insert into public.news_cover_uploads (id, club_id, uploaded_by)
     values (gen_random_uuid(), '${clubId}', '${authorId}')
     returning id`,
  );
  const postId = await database.query(
    `insert into public.news_posts
       (club_id, category, title, body, author_id, audience, status,
        cover_upload_id)
     values ('${clubId}', 'news', 'Prueba de portada', 'Ganamos.',
             '${authorId}', 'groups', '${status}', '${coverId}')
     returning id`,
  );
  await database.query(
    `insert into public.news_post_groups (post_id, group_id, club_id)
     values ('${postId}', '${groupId}', '${clubId}')`,
  );
  const attachmentPath = `${clubId}/${postId}/acta.pdf`;
  await database.query(
    `insert into public.news_post_attachments
       (post_id, club_id, file_name, content_type, size_bytes, storage_path)
     values ('${postId}', '${clubId}', 'acta.pdf', 'application/pdf', 1024,
             '${attachmentPath}')`,
  );
  const imageId = await database.query(
    `insert into public.news_inline_images (id, club_id, uploaded_by, post_id)
     values (gen_random_uuid(), '${clubId}', '${authorId}', '${postId}')
     returning id`,
  );
  return { clubId, postId, coverId, imageId, attachmentPath };
}

function deletePost(
  database: TemporaryDatabase,
  target: { readonly clubId: string; readonly postId: string },
): Promise<string> {
  return database.query(
    `select outcome || '|' || coalesce(title, '-') || '|'
            || coalesce(array_to_string(attachment_paths, ','), '-') || '|'
            || coalesce(cover_upload_id::text, '-') || '|'
            || coalesce(array_to_string(inline_image_ids, ','), '-')
       from public.delete_news_post('${target.clubId}', '${target.postId}')`,
  );
}

function countWhere(
  database: TemporaryDatabase,
  table: string,
  condition: string,
): Promise<string> {
  return database.query(
    `select count(*) from public.${table} where ${condition}`,
  );
}

describeConPostgres("borrar una publicación", () => {
  it("borra una retirada y devuelve su título y lo que identifica sus ficheros", async () => {
    const database = await migratedDatabase();
    const post = await seedPost(database, "withdrawn");

    const result = await deletePost(database, post);

    expect(result).toBe(
      [
        "deleted",
        "Prueba de portada",
        post.attachmentPath,
        post.coverId,
        post.imageId,
      ].join("|"),
    );
  });

  it("se lleva la fila, la audiencia, los adjuntos, la portada y las imágenes", async () => {
    const database = await migratedDatabase();
    const post = await seedPost(database, "withdrawn");

    await deletePost(database, post);

    const ofPost = `post_id = '${post.postId}'`;
    expect(
      await countWhere(database, "news_posts", `id = '${post.postId}'`),
    ).toBe("0");
    expect(await countWhere(database, "news_post_groups", ofPost)).toBe("0");
    expect(await countWhere(database, "news_post_attachments", ofPost)).toBe(
      "0",
    );
    expect(
      await countWhere(
        database,
        "news_cover_uploads",
        `id = '${post.coverId}'`,
      ),
    ).toBe("0");
    expect(
      await countWhere(
        database,
        "news_inline_images",
        `id = '${post.imageId}'`,
      ),
    ).toBe("0");
  });

  it("no borra una publicada y lo dice", async () => {
    const database = await migratedDatabase();
    const post = await seedPost(database, "published");

    const result = await deletePost(database, post);

    expect(result).toBe("published|-|-|-|-");
    expect(
      await countWhere(database, "news_posts", `id = '${post.postId}'`),
    ).toBe("1");
    expect(
      await countWhere(
        database,
        "news_inline_images",
        `id = '${post.imageId}'`,
      ),
    ).toBe("1");
  });

  it("con dos llamadas seguidas, la segunda dice missing", async () => {
    const database = await migratedDatabase();
    const post = await seedPost(database, "withdrawn");

    await deletePost(database, post);
    const second = await deletePost(database, post);

    expect(second).toBe("missing|-|-|-|-");
  });

  it("dice missing a una de otro club", async () => {
    const database = await migratedDatabase();
    const post = await seedPost(database, "withdrawn");
    const otherClubId = await database.query(
      `insert into public.clubs (name, slug)
       values ('Otro club', 'otro-club-' || gen_random_uuid())
       returning id`,
    );

    const result = await deletePost(database, {
      clubId: otherClubId,
      postId: post.postId,
    });

    expect(result).toBe("missing|-|-|-|-");
    expect(
      await countWhere(database, "news_posts", `id = '${post.postId}'`),
    ).toBe("1");
  });

  it("sólo la puede llamar el servidor", async () => {
    const database = await migratedDatabase();

    const grantees = await database.query(
      `select string_agg(grantee, ',' order by grantee)
         from information_schema.routine_privileges
        where routine_schema = 'public'
          and routine_name = 'delete_news_post'
          and privilege_type = 'EXECUTE'`,
    );

    expect(grantees.split(",")).not.toContain("authenticated");
    expect(grantees.split(",")).not.toContain("anon");
    expect(grantees.split(",")).toContain("service_role");
  });
});
