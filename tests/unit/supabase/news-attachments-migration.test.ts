import { expect, it } from "vitest";
import {
  type TemporaryDatabase,
  applyRepositoryMigrations,
  describeConPostgres,
  migratedDatabase,
} from "../../support/postgres";

/**
 * `0030_news_attachments.sql` contra un Postgres desechable (#328, RF-3 del
 * PRD de E11). Los adjuntos viven en un bucket privado, y ningún miembro, ni
 * siquiera quien publica, lee, sube o borra ahí con su propia sesión: todo
 * pasa por el servidor, que comprueba la audiencia antes de firmar.
 *
 * El esquema `storage` de este Postgres es el esqueleto de
 * `supabase/ci/roles.sql`: filas y policies, sin ficheros.
 */

const BUCKET = "news-attachments";
const ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/msword",
].join(",");

async function seedCommittee(database: TemporaryDatabase): Promise<string> {
  const clubId = await readClubId(database);
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

function readClubId(database: TemporaryDatabase): Promise<string> {
  return database.query(
    "select id from public.clubs where slug = 'victoria-seadragons'",
  );
}

/** La última línea de la salida: antes van las etiquetas de los `set`. */
function lastLine(output: string): string | undefined {
  return output.trim().split(/\r?\n/).at(-1);
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

describeConPostgres("almacenamiento de los adjuntos de noticias", () => {
  it("crea el bucket privado, con el límite de 10 MB y los tipos admitidos", async () => {
    const database = await migratedDatabase();

    const bucket = await database.query(
      `select public || '|' || file_size_limit || '|'
              || array_to_string(allowed_mime_types, ',')
         from storage.buckets where id = '${BUCKET}'`,
    );

    expect(bucket).toBe(`false|${ATTACHMENT_MAX_BYTES}|${ALLOWED_TYPES}`);
  });

  it("aplicada dos veces deja un solo bucket, privado", async () => {
    const database = await migratedDatabase();
    await database.query(
      `update storage.buckets set public = true where id = '${BUCKET}'`,
    );

    const again = await applyRepositoryMigrations(database);

    expect(again.code, again.stderr).toBe(0);
    expect(
      await database.query(
        `select count(*) || '|' || bool_or(public)
           from storage.buckets where id = '${BUCKET}'`,
      ),
    ).toBe("1|false");
  });

  it("no deja a quien publica subir un adjunto con su propia sesión", async () => {
    const database = await migratedDatabase();
    const committeeId = await seedCommittee(database);
    const clubId = await readClubId(database);

    const upload = await asMember(
      database,
      committeeId,
      `insert into storage.objects (bucket_id, name)
       values ('${BUCKET}', '${clubId}/post/acta.pdf')`,
    );

    expect(upload.code).not.toBe(0);
    expect(upload.stderr).toMatch(/row-level security/);
  });

  it("no deja a un miembro leer ni borrar un adjunto con su propia sesión", async () => {
    const database = await migratedDatabase();
    const committeeId = await seedCommittee(database);
    const clubId = await readClubId(database);
    await database.query(
      `insert into storage.objects (bucket_id, name)
       values ('${BUCKET}', '${clubId}/post/acta.pdf')`,
    );

    const read = await asMember(
      database,
      committeeId,
      `select count(*) from storage.objects where bucket_id = '${BUCKET}'`,
    );
    await asMember(
      database,
      committeeId,
      `delete from storage.objects where bucket_id = '${BUCKET}'`,
    );

    expect(lastLine(read.stdout)).toBe("0");
    expect(
      await database.query(
        `select count(*) from storage.objects where bucket_id = '${BUCKET}'`,
      ),
    ).toBe("1");
  });
});
