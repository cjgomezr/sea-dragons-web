import { expect, it } from "vitest";
import {
  type TemporaryDatabase,
  applyRepositoryMigrations,
  describeConPostgres,
  migratedDatabase,
} from "../../support/postgres";

/**
 * `0018_member_photos.sql` contra un Postgres desechable (#245, RF-7 del PRD
 * de E5). La foto de perfil vive en un bucket privado con una carpeta por
 * miembro, y lo que no puede depender de que la API se porte bien es que
 * nadie escriba ni borre en la carpeta de otro, ni siquiera atacando el
 * almacenamiento con su propia sesión.
 *
 * El esquema `storage` de este Postgres es el esqueleto de
 * `supabase/ci/roles.sql`: filas y policies, sin ficheros. Contra el
 * almacenamiento de verdad lo prueba el test de integración del dominio.
 */

const BUCKET = "member-photos";
const PHOTO_MAX_BYTES = 2 * 1024 * 1024;

async function seedMember(
  database: TemporaryDatabase,
  status = "active",
): Promise<string> {
  const clubId = await database.query(
    "select id from public.clubs where slug = 'victoria-seadragons'",
  );
  const userId = await database.query(
    "insert into auth.users (id) values (gen_random_uuid()) returning id",
  );
  await database.query(
    `insert into public.members
       (club_id, user_id, full_name, email, account_status)
     values ('${clubId}', '${userId}', 'Nerea Silva',
             '${userId}@example.test', '${status}')`,
  );
  return userId;
}

/** Corre `sql` como lo haría PostgREST con la sesión de `userId`. */
function asMember(
  database: TemporaryDatabase,
  userId: string,
  sql: string,
): ReturnType<TemporaryDatabase["attempt"]> {
  return database.attempt(
    `set role authenticated;
     set request.jwt.claims = '{"sub":"${userId}"}';
     ${sql}`,
  );
}

function insertObjectSql(name: string): string {
  return `insert into storage.objects (bucket_id, name)
          values ('${BUCKET}', '${name}')`;
}

describeConPostgres("almacenamiento de la foto de perfil", () => {
  it("crea el bucket privado, con el límite de 2 MB y sólo JPEG, PNG y WebP", async () => {
    const database = await migratedDatabase();

    const bucket = await database.query(
      `select public || '|' || file_size_limit || '|'
              || array_to_string(allowed_mime_types, ',')
         from storage.buckets where id = '${BUCKET}'`,
    );

    expect(bucket).toBe(
      `false|${PHOTO_MAX_BYTES}|image/jpeg,image/png,image/webp`,
    );
  });

  it("aplicada dos veces deja un solo bucket y las mismas policies", async () => {
    const database = await migratedDatabase();

    const again = await applyRepositoryMigrations(database);

    expect(again.code, again.stderr).toBe(0);
    expect(
      await database.query(
        `select count(*) from storage.buckets where id = '${BUCKET}'`,
      ),
    ).toBe("1");
    expect(
      await database.query(
        `select string_agg(policyname || ':' || cmd, ',' order by policyname)
           from pg_policies
          where schemaname = 'storage' and tablename = 'objects'`,
      ),
    ).toBe(
      "member_photos_delete_own:DELETE,member_photos_insert_own:INSERT,member_photos_select_own:SELECT",
    );
  });

  it("deja a un miembro activo subir a su propia carpeta", async () => {
    const database = await migratedDatabase();
    const userId = await seedMember(database);

    const upload = await asMember(
      database,
      userId,
      insertObjectSql(`${userId}/foto.webp`),
    );

    expect(upload.code, upload.stderr).toBe(0);
  });

  it("le niega a un miembro subir a la carpeta de otro", async () => {
    const database = await migratedDatabase();
    const intruder = await seedMember(database);
    const owner = await seedMember(database);

    const upload = await asMember(
      database,
      intruder,
      insertObjectSql(`${owner}/foto.webp`),
    );

    expect(upload.code).not.toBe(0);
    expect(upload.stderr).toMatch(/row-level security/);
  });

  it("le niega a un miembro subir fuera de toda carpeta", async () => {
    const database = await migratedDatabase();
    const userId = await seedMember(database);

    const upload = await asMember(
      database,
      userId,
      insertObjectSql("foto.webp"),
    );

    expect(upload.code).not.toBe(0);
  });

  it("le niega a un miembro dado de baja subir a su propia carpeta", async () => {
    const database = await migratedDatabase();
    const userId = await seedMember(database, "inactive");

    const upload = await asMember(
      database,
      userId,
      insertObjectSql(`${userId}/foto.webp`),
    );

    expect(upload.code).not.toBe(0);
  });

  it("no deja a un miembro ver ni borrar la foto de otro", async () => {
    const database = await migratedDatabase();
    const intruder = await seedMember(database);
    const owner = await seedMember(database);
    await database.query(insertObjectSql(`${owner}/foto.webp`));

    const seen = await asMember(
      database,
      intruder,
      `select count(*) from storage.objects where bucket_id = '${BUCKET}'`,
    );
    await asMember(
      database,
      intruder,
      `delete from storage.objects where name = '${owner}/foto.webp'`,
    );

    expect(seen.stdout.trim()).toBe("0");
    expect(
      await database.query(
        `select count(*) from storage.objects where name = '${owner}/foto.webp'`,
      ),
    ).toBe("1");
  });

  it("deja a un miembro borrar su propia foto", async () => {
    const database = await migratedDatabase();
    const userId = await seedMember(database);
    await database.query(insertObjectSql(`${userId}/foto.webp`));

    const removal = await asMember(
      database,
      userId,
      `delete from storage.objects where name = '${userId}/foto.webp'`,
    );

    expect(removal.code, removal.stderr).toBe(0);
    expect(await database.query(`select count(*) from storage.objects`)).toBe(
      "0",
    );
  });

  it("no toca los objetos de otros buckets", async () => {
    const database = await migratedDatabase();
    const userId = await seedMember(database);
    await database.query(
      "insert into storage.buckets (id, name) values ('noticias', 'noticias')",
    );

    const upload = await asMember(
      database,
      userId,
      `insert into storage.objects (bucket_id, name)
       values ('noticias', '${userId}/adjunto.pdf')`,
    );

    expect(upload.code).not.toBe(0);
  });

  it("añade a members la ruta de la foto, vacía por defecto", async () => {
    const database = await migratedDatabase();
    const userId = await seedMember(database);

    expect(
      await database.query(
        `select coalesce(photo_path, 'sin foto') from public.members
          where user_id = '${userId}'`,
      ),
    ).toBe("sin foto");
  });

  it("rechaza en members una ruta que no cuelga de la carpeta del miembro", async () => {
    const database = await migratedDatabase();
    const owner = await seedMember(database);
    const other = await seedMember(database);

    const update = await database.attempt(
      `update public.members set photo_path = '${other}/foto.webp'
        where user_id = '${owner}'`,
    );

    expect(update.code).not.toBe(0);
    expect(update.stderr).toMatch(/members_photo_path_in_own_folder/);
  });

  it("acepta en members una ruta dentro de la carpeta del miembro", async () => {
    const database = await migratedDatabase();
    const userId = await seedMember(database);

    const update = await database.attempt(
      `update public.members set photo_path = '${userId}/foto.webp'
        where user_id = '${userId}'`,
    );

    expect(update.code, update.stderr).toBe(0);
  });

  it("no deja a un miembro escribir su ruta de foto en members", async () => {
    const database = await migratedDatabase();
    const userId = await seedMember(database);

    const update = await asMember(
      database,
      userId,
      `update public.members set photo_path = '${userId}/foto.webp'
        where user_id = '${userId}'`,
    );

    expect(update.code).not.toBe(0);
    expect(update.stderr).toMatch(/permission denied/);
  });
});
