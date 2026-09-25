import { expect, it } from "vitest";
import {
  type RunResult,
  type TemporaryDatabase,
  applyRepositoryMigrations,
  describeConPostgres,
  migratedDatabase,
} from "../../support/postgres";

/**
 * `public.news_posts`, `public.news_post_groups` y
 * `public.news_post_attachments` contra un Postgres desechable (#326, RF-1 del
 * PRD de E11). La regla que más importa es la de lectura: un miembro sólo
 * recibe, ni siquiera llamando a la base directamente, las publicaciones de su
 * club dirigidas a él y no retiradas.
 */

/** Los límites que la migración nombra. */
const TITLE_MAX_LENGTH = 120;
const MAX_ATTACHMENTS_PER_POST = 5;
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

/** Etiquetas que psql imprime entre las filas que sí interesan. */
const COMMAND_TAGS: ReadonlySet<string> = new Set(["SET"]);

async function seededClubId(database: TemporaryDatabase): Promise<string> {
  return database.query(
    "select id from public.clubs where slug = 'victoria-seadragons'",
  );
}

async function seedOtherClub(database: TemporaryDatabase): Promise<string> {
  return database.query(
    `insert into public.clubs (name, slug)
     values ('Otro club', 'otro-club-' || gen_random_uuid())
     returning id`,
  );
}

interface SeedMemberOptions {
  readonly clubId?: string;
  readonly accountStatus?: "incomplete" | "active" | "inactive";
}

/** Crea una identidad y su socio, y devuelve el `user_id` que los une. */
async function seedMember(
  database: TemporaryDatabase,
  options: SeedMemberOptions = {},
): Promise<string> {
  const clubId = options.clubId ?? (await seededClubId(database));
  const accountStatus = options.accountStatus ?? "active";
  const userId = await database.query(
    "insert into auth.users (id) values (gen_random_uuid()) returning id",
  );
  await database.query(
    `insert into public.members (club_id, user_id, full_name, email, account_status)
     values ('${clubId}', '${userId}', 'Socio de prueba',
             '${userId}@example.test', '${accountStatus}')`,
  );
  return userId;
}

async function seedGroup(
  database: TemporaryDatabase,
  name: string,
  clubId?: string,
): Promise<string> {
  const club = clubId ?? (await seededClubId(database));
  return database.query(
    `insert into public.groups (club_id, name) values ('${club}', '${name}')
     returning id`,
  );
}

async function addToGroup(
  database: TemporaryDatabase,
  groupId: string,
  userId: string,
): Promise<void> {
  await database.query(
    `insert into public.group_memberships (group_id, user_id, club_id)
     select '${groupId}', '${userId}', club_id from public.groups
      where id = '${groupId}'`,
  );
}

/** Columnas de una publicación, en SQL literal: una cadena va entre comillas. */
interface PostColumns {
  readonly authorId: string;
  readonly clubId?: string;
  readonly category?: string;
  readonly title?: string;
  readonly body?: string;
  readonly audience?: string;
  readonly status?: string;
}

function insertPostSql(post: PostColumns, clubId: string): string {
  return `insert into public.news_posts
            (club_id, category, title, body, author_id, audience, status)
          values ('${clubId}', ${post.category ?? "'news'"},
                  ${post.title ?? "'Cambio de piscina'"},
                  ${post.body ?? "'El sábado entrenamos en MSAC.'"},
                  '${post.authorId}', ${post.audience ?? "'club'"},
                  ${post.status ?? "'published'"})`;
}

async function insertPost(
  database: TemporaryDatabase,
  post: PostColumns,
): Promise<RunResult> {
  const clubId = post.clubId ?? (await seededClubId(database));
  return database.attempt(insertPostSql(post, clubId));
}

async function seedPost(
  database: TemporaryDatabase,
  post: PostColumns,
): Promise<string> {
  const clubId = post.clubId ?? (await seededClubId(database));
  return database.query(`${insertPostSql(post, clubId)} returning id`);
}

async function targetGroup(
  database: TemporaryDatabase,
  postId: string,
  groupId: string,
): Promise<RunResult> {
  return database.attempt(
    `insert into public.news_post_groups (post_id, group_id, club_id)
     select '${postId}', '${groupId}', club_id from public.news_posts
      where id = '${postId}'`,
  );
}

async function insertAttachment(
  database: TemporaryDatabase,
  postId: string,
): Promise<RunResult> {
  return database.attempt(
    `insert into public.news_post_attachments
       (post_id, club_id, file_name, content_type, size_bytes, storage_path)
     select id, club_id, 'politica.pdf', 'application/pdf', 1024,
            club_id || '/' || id || '/' || gen_random_uuid() || '.pdf'
       from public.news_posts where id = '${postId}'`,
  );
}

function count(database: TemporaryDatabase, table: string): Promise<string> {
  return database.query(`select count(*) from public.${table}`);
}

type ApiIdentity =
  | { readonly role: "anon" }
  | { readonly role: "authenticated"; readonly subject: string };

/** Lo que PostgREST monta antes de cada consulta: el rol de la API y, si hay
 * sesión, el `sub` del JWT que `auth.uid()` lee. */
function asApiIdentity(identity: ApiIdentity, sql: string): string {
  const claims =
    identity.role === "anon"
      ? ""
      : `set request.jwt.claims = '{"sub":"${identity.subject}"}'; `;
  return `set role ${identity.role}; ${claims}${sql}`;
}

function rowsOf(result: RunResult): string[] {
  return result.stdout
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !COMMAND_TAGS.has(line));
}

async function readAs(
  database: TemporaryDatabase,
  subject: string,
  sql: string,
): Promise<string[]> {
  const lectura = await database.attempt(
    asApiIdentity({ role: "authenticated", subject }, sql),
  );
  expect(lectura.code, lectura.stderr).toBe(0);
  return rowsOf(lectura);
}

function visibleTitles(
  database: TemporaryDatabase,
  subject: string,
): Promise<string[]> {
  return readAs(
    database,
    subject,
    "select title from public.news_posts order by title",
  );
}

function columnsOf(
  database: TemporaryDatabase,
  table: string,
): Promise<string> {
  return database.query(
    `select column_name || ' ' || data_type || ' null=' || is_nullable
       from information_schema.columns
      where table_schema = 'public' and table_name = '${table}'
      order by column_name`,
  );
}

describeConPostgres("migración de las publicaciones", () => {
  it("guarda de cada publicación club, categoría, título, cuerpo, autor, fechas, audiencia y estado", async () => {
    const database = await migratedDatabase();

    const columns = await columnsOf(database, "news_posts");

    expect(columns.split("\n")).toEqual([
      "audience text null=NO",
      "author_id uuid null=NO",
      "body text null=NO",
      "category text null=NO",
      "club_id uuid null=NO",
      "edited_at timestamp with time zone null=YES",
      "id uuid null=NO",
      "published_at timestamp with time zone null=NO",
      "status text null=NO",
      "title text null=NO",
    ]);
  });

  it("guarda de cada audiencia de grupos la publicación, el grupo y el club", async () => {
    const database = await migratedDatabase();

    const columns = await columnsOf(database, "news_post_groups");

    expect(columns.split("\n")).toEqual([
      "club_id uuid null=NO",
      "group_id uuid null=NO",
      "post_id uuid null=NO",
    ]);
  });

  it("guarda de cada adjunto su publicación, nombre, tipo, tamaño y ruta", async () => {
    const database = await migratedDatabase();

    const columns = await columnsOf(database, "news_post_attachments");

    expect(columns.split("\n")).toEqual([
      "club_id uuid null=NO",
      "content_type text null=NO",
      "created_at timestamp with time zone null=NO",
      "file_name text null=NO",
      "id uuid null=NO",
      "post_id uuid null=NO",
      "size_bytes bigint null=NO",
      "storage_path text null=NO",
    ]);
  });

  it("es idempotente: aplicada dos veces no falla ni duplica nada", async () => {
    const database = await migratedDatabase();
    const despuesDeLaPrimera = await database.snapshot();

    const segunda = await applyRepositoryMigrations(database);

    expect(segunda.code, segunda.stderr).toBe(0);
    expect(despuesDeLaPrimera).toMatch(/tabla news_posts rls=t/);
    expect(despuesDeLaPrimera).toMatch(/tabla news_post_groups rls=t/);
    expect(despuesDeLaPrimera).toMatch(/tabla news_post_attachments rls=t/);
    expect(await database.snapshot()).toBe(despuesDeLaPrimera);
  });
});

describeConPostgres("las reglas de una publicación", () => {
  it.each(["announcement", "news", "document"])(
    "acepta la categoría %s",
    async (category) => {
      const database = await migratedDatabase();
      const authorId = await seedMember(database);

      const insercion = await insertPost(database, {
        authorId,
        category: `'${category}'`,
      });

      expect(insercion.code, insercion.stderr).toBe(0);
    },
  );

  it("rechaza una categoría que no es announcement, news ni document", async () => {
    const database = await migratedDatabase();
    const authorId = await seedMember(database);

    const insercion = await insertPost(database, {
      authorId,
      category: "'event'",
    });

    expect(insercion.code).toBeGreaterThan(0);
    expect(insercion.stderr).toMatch(/news_posts_category_check/);
  });

  it.each([
    ["vacío", "''"],
    ["de solo espacios", "'   '"],
    ["más largo que el límite", `repeat('x', ${TITLE_MAX_LENGTH + 1})`],
  ])("rechaza un título %s", async (_caso, title) => {
    const database = await migratedDatabase();
    const authorId = await seedMember(database);

    const insercion = await insertPost(database, { authorId, title });

    expect(insercion.code).toBeGreaterThan(0);
    expect(insercion.stderr).toMatch(/news_posts_title_length/);
  });

  it(`acepta un título de ${TITLE_MAX_LENGTH} caracteres`, async () => {
    const database = await migratedDatabase();
    const authorId = await seedMember(database);

    const insercion = await insertPost(database, {
      authorId,
      title: `repeat('x', ${TITLE_MAX_LENGTH})`,
    });

    expect(insercion.code, insercion.stderr).toBe(0);
  });

  it.each([
    ["vacío", "''"],
    ["de solo espacios", "' \n '"],
  ])("rechaza un cuerpo %s", async (_caso, body) => {
    const database = await migratedDatabase();
    const authorId = await seedMember(database);

    const insercion = await insertPost(database, { authorId, body });

    expect(insercion.code).toBeGreaterThan(0);
    expect(insercion.stderr).toMatch(/news_posts_body_not_blank/);
  });

  it("rechaza una audiencia que no es el club ni grupos", async () => {
    const database = await migratedDatabase();
    const authorId = await seedMember(database);

    const insercion = await insertPost(database, {
      authorId,
      audience: "'everyone'",
    });

    expect(insercion.code).toBeGreaterThan(0);
    expect(insercion.stderr).toMatch(/news_posts_audience_check/);
  });

  it("rechaza un estado que no es publicada ni retirada", async () => {
    const database = await migratedDatabase();
    const authorId = await seedMember(database);

    const insercion = await insertPost(database, {
      authorId,
      status: "'draft'",
    });

    expect(insercion.code).toBeGreaterThan(0);
    expect(insercion.stderr).toMatch(/news_posts_status_check/);
  });

  it("nace publicada, con fecha de publicación y sin fecha de edición", async () => {
    const database = await migratedDatabase();
    const authorId = await seedMember(database);
    const clubId = await seededClubId(database);

    const postId = await database.query(
      `insert into public.news_posts (club_id, category, title, body, author_id, audience)
       values ('${clubId}', 'news', 'Título', 'Cuerpo', '${authorId}', 'club')
       returning id`,
    );

    expect(
      await database.query(
        `select status || ' ' || (published_at is not null) || ' ' || (edited_at is null)
           from public.news_posts where id = '${postId}'`,
      ),
    ).toBe("published true true");
  });

  it("rechaza un autor de otro club", async () => {
    const database = await migratedDatabase();
    const otherClubId = await seedOtherClub(database);
    const authorId = await seedMember(database, { clubId: otherClubId });

    const insercion = await insertPost(database, { authorId });

    expect(insercion.code).toBeGreaterThan(0);
    expect(insercion.stderr).toMatch(/news_posts_author_same_club_fkey/);
  });

  it("dirigida a todo el club no necesita ninguna fila de audiencia", async () => {
    const database = await migratedDatabase();
    const authorId = await seedMember(database);

    const insercion = await insertPost(database, { authorId });

    expect(insercion.code, insercion.stderr).toBe(0);
    expect(await count(database, "news_post_groups")).toBe("0");
  });

  it("distingue una dirigida a todo el club de una dirigida a cero grupos", async () => {
    const database = await migratedDatabase();
    const authorId = await seedMember(database);
    await seedPost(database, { authorId, title: "'Al club'" });
    await seedPost(database, {
      authorId,
      title: "'A ningún grupo'",
      audience: "'groups'",
    });

    const audiencias = await database.query(
      "select title || ' ' || audience from public.news_posts order by title",
    );

    expect(audiencias.split("\n")).toEqual([
      "A ningún grupo groups",
      "Al club club",
    ]);
    expect(await count(database, "news_post_groups")).toBe("0");
  });
});

describeConPostgres("la audiencia de grupos", () => {
  it("acepta un grupo del club de la publicación", async () => {
    const database = await migratedDatabase();
    const authorId = await seedMember(database);
    const groupId = await seedGroup(database, "Senior Squad");
    const postId = await seedPost(database, {
      authorId,
      audience: "'groups'",
    });

    const insercion = await targetGroup(database, postId, groupId);

    expect(insercion.code, insercion.stderr).toBe(0);
  });

  it("rechaza un grupo de otro club", async () => {
    const database = await migratedDatabase();
    const authorId = await seedMember(database);
    const otherGroupId = await seedGroup(
      database,
      "Senior Squad",
      await seedOtherClub(database),
    );
    const postId = await seedPost(database, {
      authorId,
      audience: "'groups'",
    });

    const insercion = await targetGroup(database, postId, otherGroupId);

    expect(insercion.code).toBeGreaterThan(0);
    expect(insercion.stderr).toMatch(/news_post_groups_group_same_club_fkey/);
  });

  it("rechaza el mismo grupo dos veces en la misma publicación", async () => {
    const database = await migratedDatabase();
    const authorId = await seedMember(database);
    const groupId = await seedGroup(database, "Senior Squad");
    const postId = await seedPost(database, {
      authorId,
      audience: "'groups'",
    });
    await targetGroup(database, postId, groupId);

    const segunda = await targetGroup(database, postId, groupId);

    expect(segunda.code).toBeGreaterThan(0);
    expect(segunda.stderr).toMatch(/news_post_groups_pkey/);
  });

  it("borrar un grupo quita su fila de audiencia y conserva la publicación", async () => {
    const database = await migratedDatabase();
    const authorId = await seedMember(database);
    const groupId = await seedGroup(database, "Senior Squad");
    const postId = await seedPost(database, {
      authorId,
      audience: "'groups'",
    });
    await targetGroup(database, postId, groupId);

    await database.query(`delete from public.groups where id = '${groupId}'`);

    expect(await count(database, "news_post_groups")).toBe("0");
    expect(await count(database, "news_posts")).toBe("1");
  });
});

describeConPostgres("los adjuntos de una publicación", () => {
  it(`acepta hasta ${MAX_ATTACHMENTS_PER_POST} adjuntos`, async () => {
    const database = await migratedDatabase();
    const authorId = await seedMember(database);
    const postId = await seedPost(database, { authorId });

    for (let index = 0; index < MAX_ATTACHMENTS_PER_POST; index += 1) {
      const insercion = await insertAttachment(database, postId);
      expect(insercion.code, insercion.stderr).toBe(0);
    }

    expect(await count(database, "news_post_attachments")).toBe(
      String(MAX_ATTACHMENTS_PER_POST),
    );
  });

  it("rechaza el sexto adjunto de la misma publicación", async () => {
    const database = await migratedDatabase();
    const authorId = await seedMember(database);
    const postId = await seedPost(database, { authorId });
    for (let index = 0; index < MAX_ATTACHMENTS_PER_POST; index += 1) {
      await insertAttachment(database, postId);
    }

    const sexto = await insertAttachment(database, postId);

    expect(sexto.code).toBeGreaterThan(0);
    expect(sexto.stderr).toMatch(/news_post_attachments_max_per_post/);
    expect(await count(database, "news_post_attachments")).toBe(
      String(MAX_ATTACHMENTS_PER_POST),
    );
  });

  it("el límite es por publicación: otra publicación tiene sus propios cinco", async () => {
    const database = await migratedDatabase();
    const authorId = await seedMember(database);
    const llena = await seedPost(database, { authorId, title: "'Llena'" });
    const otra = await seedPost(database, { authorId, title: "'Otra'" });
    for (let index = 0; index < MAX_ATTACHMENTS_PER_POST; index += 1) {
      await insertAttachment(database, llena);
    }

    const insercion = await insertAttachment(database, otra);

    expect(insercion.code, insercion.stderr).toBe(0);
  });

  it("rechaza mover un adjunto a una publicación que ya tiene cinco", async () => {
    const database = await migratedDatabase();
    const authorId = await seedMember(database);
    const llena = await seedPost(database, { authorId, title: "'Llena'" });
    const otra = await seedPost(database, { authorId, title: "'Otra'" });
    for (let index = 0; index < MAX_ATTACHMENTS_PER_POST; index += 1) {
      await insertAttachment(database, llena);
    }
    await insertAttachment(database, otra);

    const movimiento = await database.attempt(
      `update public.news_post_attachments set post_id = '${llena}'
        where post_id = '${otra}'`,
    );

    expect(movimiento.code).toBeGreaterThan(0);
    expect(movimiento.stderr).toMatch(/news_post_attachments_max_per_post/);
  });

  it.each([
    ["de cero bytes", 0],
    ["de más de 10 MB", MAX_ATTACHMENT_BYTES + 1],
  ])("rechaza un adjunto %s", async (_caso, sizeBytes) => {
    const database = await migratedDatabase();
    const authorId = await seedMember(database);
    const postId = await seedPost(database, { authorId });

    const insercion = await database.attempt(
      `insert into public.news_post_attachments
         (post_id, club_id, file_name, content_type, size_bytes, storage_path)
       select id, club_id, 'a.pdf', 'application/pdf', ${sizeBytes}, 'ruta/a.pdf'
         from public.news_posts where id = '${postId}'`,
    );

    expect(insercion.code).toBeGreaterThan(0);
    expect(insercion.stderr).toMatch(/news_post_attachments_size_bytes_check/);
  });

  it("rechaza dos adjuntos con la misma ruta de almacenamiento", async () => {
    const database = await migratedDatabase();
    const authorId = await seedMember(database);
    const postId = await seedPost(database, { authorId });
    const insertSamePath = `insert into public.news_post_attachments
         (post_id, club_id, file_name, content_type, size_bytes, storage_path)
       select id, club_id, 'a.pdf', 'application/pdf', 10, 'ruta/a.pdf'
         from public.news_posts where id = '${postId}'`;
    await database.query(insertSamePath);

    const segunda = await database.attempt(insertSamePath);

    expect(segunda.code).toBeGreaterThan(0);
    expect(segunda.stderr).toMatch(/news_post_attachments_storage_path_key/);
  });

  it("rechaza un adjunto que dice ser de otro club que su publicación", async () => {
    const database = await migratedDatabase();
    const authorId = await seedMember(database);
    const postId = await seedPost(database, { authorId });
    const otherClubId = await seedOtherClub(database);

    const insercion = await database.attempt(
      `insert into public.news_post_attachments
         (post_id, club_id, file_name, content_type, size_bytes, storage_path)
       values ('${postId}', '${otherClubId}', 'a.pdf', 'application/pdf', 10,
               'ruta/a.pdf')`,
    );

    expect(insercion.code).toBeGreaterThan(0);
    expect(insercion.stderr).toMatch(
      /news_post_attachments_post_same_club_fkey/,
    );
  });

  it("borrar una publicación se lleva sus adjuntos y su audiencia", async () => {
    const database = await migratedDatabase();
    const authorId = await seedMember(database);
    const groupId = await seedGroup(database, "Senior Squad");
    const postId = await seedPost(database, {
      authorId,
      audience: "'groups'",
    });
    await targetGroup(database, postId, groupId);
    await insertAttachment(database, postId);

    await database.query(
      `delete from public.news_posts where id = '${postId}'`,
    );

    expect(await count(database, "news_post_attachments")).toBe("0");
    expect(await count(database, "news_post_groups")).toBe("0");
    expect(await count(database, "groups")).toBe("1");
  });
});

describeConPostgres("quién ve qué publicación", () => {
  it("un miembro del club recibe una publicación dirigida a todo el club", async () => {
    const database = await migratedDatabase();
    const authorId = await seedMember(database);
    const socio = await seedMember(database);
    await seedPost(database, { authorId, title: "'Al club'" });

    expect(await visibleTitles(database, socio)).toEqual(["Al club"]);
  });

  it("un miembro de un grupo de la audiencia la recibe", async () => {
    const database = await migratedDatabase();
    const authorId = await seedMember(database);
    const socio = await seedMember(database);
    const groupId = await seedGroup(database, "Senior Squad");
    await addToGroup(database, groupId, socio);
    const postId = await seedPost(database, {
      authorId,
      title: "'Al Senior'",
      audience: "'groups'",
    });
    await targetGroup(database, postId, groupId);

    expect(await visibleTitles(database, socio)).toEqual(["Al Senior"]);
  });

  it("un miembro fuera de los grupos de la audiencia no la recibe", async () => {
    const database = await migratedDatabase();
    const authorId = await seedMember(database);
    const socio = await seedMember(database);
    const senior = await seedGroup(database, "Senior Squad");
    const junior = await seedGroup(database, "Junior Squad");
    await addToGroup(database, junior, socio);
    const postId = await seedPost(database, {
      authorId,
      audience: "'groups'",
    });
    await targetGroup(database, postId, senior);

    expect(await visibleTitles(database, socio)).toEqual([]);
  });

  it("una dirigida a cero grupos no la recibe nadie", async () => {
    const database = await migratedDatabase();
    const authorId = await seedMember(database);
    const socio = await seedMember(database);
    const groupId = await seedGroup(database, "Senior Squad");
    await addToGroup(database, groupId, socio);
    await seedPost(database, { authorId, audience: "'groups'" });

    expect(await visibleTitles(database, socio)).toEqual([]);
  });

  it("una retirada no la recibe nadie", async () => {
    const database = await migratedDatabase();
    const authorId = await seedMember(database);
    const socio = await seedMember(database);
    await seedPost(database, { authorId, status: "'withdrawn'" });

    expect(await visibleTitles(database, socio)).toEqual([]);
    expect(await visibleTitles(database, authorId)).toEqual([]);
  });

  it("una de otro club no la recibe un miembro de este", async () => {
    const database = await migratedDatabase();
    const otherClubId = await seedOtherClub(database);
    const otherAuthor = await seedMember(database, { clubId: otherClubId });
    const socio = await seedMember(database);
    await seedPost(database, { authorId: otherAuthor, clubId: otherClubId });

    expect(await visibleTitles(database, socio)).toEqual([]);
  });

  it("un miembro dado de baja no recibe ni las del club ni las de su grupo", async () => {
    const database = await migratedDatabase();
    const authorId = await seedMember(database);
    const socio = await seedMember(database, { accountStatus: "inactive" });
    const groupId = await seedGroup(database, "Senior Squad");
    await addToGroup(database, groupId, socio);
    await seedPost(database, { authorId, title: "'Al club'" });
    const postId = await seedPost(database, {
      authorId,
      title: "'Al Senior'",
      audience: "'groups'",
    });
    await targetGroup(database, postId, groupId);

    expect(await visibleTitles(database, socio)).toEqual([]);
  });

  it("una identidad sin socio no recibe nada", async () => {
    const database = await migratedDatabase();
    const authorId = await seedMember(database);
    await seedPost(database, { authorId });
    const sinSocio = await database.query(
      "insert into auth.users (id) values (gen_random_uuid()) returning id",
    );

    expect(await visibleTitles(database, sinSocio)).toEqual([]);
  });

  it("un miembro ve los adjuntos de lo que recibe y no los de lo que no", async () => {
    const database = await migratedDatabase();
    const authorId = await seedMember(database);
    const socio = await seedMember(database);
    const groupId = await seedGroup(database, "Senior Squad");
    const alClub = await seedPost(database, { authorId, title: "'Al club'" });
    const ajena = await seedPost(database, {
      authorId,
      title: "'Al Senior'",
      audience: "'groups'",
    });
    await targetGroup(database, ajena, groupId);
    await insertAttachment(database, alClub);
    await insertAttachment(database, ajena);

    const adjuntos = await readAs(
      database,
      socio,
      "select post_id from public.news_post_attachments",
    );

    expect(adjuntos).toEqual([alClub]);
  });

  it("un miembro ve la fila de audiencia de su grupo y no la de otros", async () => {
    const database = await migratedDatabase();
    const authorId = await seedMember(database);
    const socio = await seedMember(database);
    const senior = await seedGroup(database, "Senior Squad");
    const junior = await seedGroup(database, "Junior Squad");
    await addToGroup(database, senior, socio);
    const postId = await seedPost(database, {
      authorId,
      audience: "'groups'",
    });
    await targetGroup(database, postId, senior);
    await targetGroup(database, postId, junior);

    const audiencia = await readAs(
      database,
      socio,
      "select group_id from public.news_post_groups",
    );

    expect(audiencia).toEqual([senior]);
  });
});

describeConPostgres("privilegios de las publicaciones", () => {
  it.each([
    [
      "publicar",
      "news_posts",
      (userId: string) =>
        `insert into public.news_posts
           (club_id, category, title, body, author_id, audience)
         select club_id, 'news', 'Mía', 'Cuerpo', user_id, 'club'
           from public.members where user_id = '${userId}'`,
    ],
    [
      "editar una publicación",
      "news_posts",
      () => "update public.news_posts set title = 'Cambiado'",
    ],
    [
      "borrar una publicación",
      "news_posts",
      () => "delete from public.news_posts",
    ],
    [
      "cambiar la audiencia",
      "news_post_groups",
      () => "delete from public.news_post_groups",
    ],
    [
      "añadir un adjunto",
      "news_post_attachments",
      () =>
        `insert into public.news_post_attachments
           (post_id, club_id, file_name, content_type, size_bytes, storage_path)
         select id, club_id, 'a.pdf', 'application/pdf', 1, 'r/a.pdf'
           from public.news_posts`,
    ],
    [
      "borrar un adjunto",
      "news_post_attachments",
      () => "delete from public.news_post_attachments",
    ],
  ] as const)("no deja a un miembro %s", async (_accion, table, buildSql) => {
    // Se exige el error, no sólo que nada cambie: sin el `revoke`, RLS
    // negaría en silencio y el cliente creería que guardó.
    const database = await migratedDatabase();
    const socio = await seedMember(database);
    await seedPost(database, { authorId: socio });

    const intento = await database.attempt(
      asApiIdentity({ role: "authenticated", subject: socio }, buildSql(socio)),
    );

    expect(intento.code).toBeGreaterThan(0);
    expect(intento.stderr).toMatch(
      new RegExp(`permission denied for table ${table}`),
    );
  });

  it.each(["news_posts", "news_post_groups", "news_post_attachments"])(
    "no deja a un cliente anónimo ver nada de %s",
    async (table) => {
      const database = await migratedDatabase();

      const lectura = await database.attempt(
        asApiIdentity({ role: "anon" }, `select * from public.${table}`),
      );

      expect(lectura.code).toBeGreaterThan(0);
      expect(lectura.stderr).toMatch(
        new RegExp(`permission denied for table ${table}`),
      );
    },
  );

  it("deja a anon sin privilegios y a authenticated sólo con la lectura", async () => {
    const database = await migratedDatabase();

    const privilegios = await database.query(
      `select table_name || ' ' || grantee || ' ' || privilege_type
         from information_schema.table_privileges
        where table_schema = 'public'
          and table_name like 'news_post%'
          and grantee in ('anon', 'authenticated')
        order by table_name, grantee, privilege_type`,
    );

    expect(privilegios.split("\n")).toEqual([
      "news_post_attachments authenticated SELECT",
      "news_post_groups authenticated SELECT",
      "news_posts authenticated SELECT",
    ]);
  });

  it.each(["news_posts", "news_post_groups", "news_post_attachments"])(
    "le deja al servidor leer y escribir %s",
    async (table) => {
      const database = await migratedDatabase();

      const privilegios = await database.query(
        `select privilege_type
           from information_schema.table_privileges
          where table_schema = 'public' and table_name = '${table}'
            and grantee = 'service_role'`,
      );

      expect(privilegios.split("\n")).toEqual(
        expect.arrayContaining(["DELETE", "INSERT", "SELECT", "UPDATE"]),
      );
    },
  );

  it("el servidor publica con la llave de servicio", async () => {
    const database = await migratedDatabase();
    const authorId = await seedMember(database);
    const clubId = await seededClubId(database);

    const insercion = await database.attempt(
      `set role service_role; ${insertPostSql({ authorId }, clubId)}`,
    );

    expect(insercion.code, insercion.stderr).toBe(0);
  });
});
