import { expect, it } from "vitest";
import {
  type TemporaryDatabase,
  applyRepositoryMigrations,
  describeConPostgres,
  migratedDatabase,
} from "../../support/postgres";

/**
 * `0024_club_logos.sql` contra un Postgres desechable (#295, RF-4 del PRD de
 * E18a). El logo del club vive en un bucket público de lectura, porque un
 * correo se abre fuera de la aplicación. Escribir en él es sólo de la llave de
 * servicio: ningún miembro, ni siquiera un Admin con su propia sesión, sube o
 * borra ahí atacando el almacenamiento directamente.
 *
 * El esquema `storage` de este Postgres es el esqueleto de
 * `supabase/ci/roles.sql`: filas y policies, sin ficheros.
 */

const BUCKET = "club-logos";
const LOGO_MAX_BYTES = 512 * 1024;

async function seedAdmin(database: TemporaryDatabase): Promise<string> {
  const clubId = await readClubId(database);
  const userId = await database.query(
    "insert into auth.users (id) values (gen_random_uuid()) returning id",
  );
  await database.query(
    `insert into public.members
       (club_id, user_id, full_name, email, account_status, role)
     values ('${clubId}', '${userId}', 'Alba Ferrer',
             '${userId}@example.test', 'active', 'Admin')`,
  );
  return userId;
}

function readClubId(database: TemporaryDatabase): Promise<string> {
  return database.query(
    "select id from public.clubs where slug = 'victoria-seadragons'",
  );
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

describeConPostgres("almacenamiento del logo del club", () => {
  it("crea el bucket público, con el límite de 512 KB y sólo PNG y WebP", async () => {
    const database = await migratedDatabase();

    const bucket = await database.query(
      `select public || '|' || file_size_limit || '|'
              || array_to_string(allowed_mime_types, ',')
         from storage.buckets where id = '${BUCKET}'`,
    );

    expect(bucket).toBe(`true|${LOGO_MAX_BYTES}|image/png,image/webp`);
  });

  it("aplicada dos veces deja un solo bucket, igual que la primera", async () => {
    const database = await migratedDatabase();
    await database.query(
      `update storage.buckets set public = false where id = '${BUCKET}'`,
    );

    const again = await applyRepositoryMigrations(database);

    expect(again.code, again.stderr).toBe(0);
    expect(
      await database.query(
        `select count(*) || '|' || bool_and(public)
           from storage.buckets where id = '${BUCKET}'`,
      ),
    ).toBe("1|true");
  });

  it("no deja a un Admin subir un logo con su propia sesión", async () => {
    const database = await migratedDatabase();
    const adminId = await seedAdmin(database);
    const clubId = await readClubId(database);

    const upload = await asMember(
      database,
      adminId,
      `insert into storage.objects (bucket_id, name)
       values ('${BUCKET}', '${clubId}/logo.png')`,
    );

    expect(upload.code).not.toBe(0);
    expect(upload.stderr).toMatch(/row-level security/);
  });

  it("no deja a un Admin borrar el logo con su propia sesión", async () => {
    const database = await migratedDatabase();
    const adminId = await seedAdmin(database);
    const clubId = await readClubId(database);
    await database.query(
      `insert into storage.objects (bucket_id, name)
       values ('${BUCKET}', '${clubId}/logo.png')`,
    );

    await asMember(
      database,
      adminId,
      `delete from storage.objects where bucket_id = '${BUCKET}'`,
    );

    expect(
      await database.query(
        `select count(*) from storage.objects where bucket_id = '${BUCKET}'`,
      ),
    ).toBe("1");
  });
});
