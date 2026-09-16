import { expect, it } from "vitest";
import {
  type TemporaryDatabase,
  describeConPostgres,
  migratedDatabase,
} from "../../support/postgres";

/**
 * `public.registration_requests` contra un Postgres desechable. Es el límite
 * del registro (#173): si la llave anónima pudiera vaciarla, cualquiera
 * apagaría el límite desde el navegador y volvería a poder agotar el cupo
 * propio de correos; si pudiera leerla, tendría la lista de sujetos que
 * intentaron registrarse.
 */

async function privilegesOf(
  database: TemporaryDatabase,
  grantee: string,
): Promise<string[]> {
  const rows = await database.query(
    `select privilege_type
       from information_schema.role_table_grants
      where table_schema = 'public'
        and table_name = 'registration_requests'
        and grantee = '${grantee}'
      order by privilege_type`,
  );
  return rows === "" ? [] : rows.split("\n");
}

describeConPostgres("migración del límite del registro", () => {
  it("guarda el club, el tipo de sujeto, su hash y el instante", async () => {
    const database = await migratedDatabase();

    const columns = await database.query(
      `select column_name || ' ' || data_type || ' null=' || is_nullable
         from information_schema.columns
        where table_schema = 'public'
          and table_name = 'registration_requests'
        order by column_name`,
    );

    expect(columns.split("\n")).toEqual([
      "club_id uuid null=NO",
      "id uuid null=NO",
      "requested_at timestamp with time zone null=NO",
      "subject_hash text null=NO",
      "subject_kind text null=NO",
    ]);
  });

  it("no guarda ni la IP ni el correo en claro", async () => {
    const database = await migratedDatabase();

    const columns = await database.query(
      `select column_name
         from information_schema.columns
        where table_schema = 'public'
          and table_name = 'registration_requests'`,
    );

    expect(columns).not.toContain("ip");
    expect(columns).not.toMatch(/\bemail\b/);
  });

  it("cierra el conjunto de sujetos que sabe contar", async () => {
    const database = await migratedDatabase();

    const rechazo = await database.attempt(
      `insert into public.registration_requests (club_id, subject_kind, subject_hash)
       select id, 'telefono', 'deadbeef' from public.clubs limit 1`,
    );

    expect(rechazo.code).not.toBe(0);
  });

  it("tiene el índice de la consulta del límite", async () => {
    const database = await migratedDatabase();

    const index = await database.query(
      `select indexdef from pg_indexes
        where schemaname = 'public'
          and indexname = 'registration_requests_subject_requested_at_idx'`,
    );

    expect(index).toContain("subject_kind, subject_hash, requested_at DESC");
  });

  it("nace con RLS activo", async () => {
    const database = await migratedDatabase();

    const rls = await database.query(
      `select relrowsecurity from pg_class
        where oid = 'public.registration_requests'::regclass`,
    );

    expect(rls).toBe("t");
  });

  it("deja escrita la policy que le niega la lectura a quien tiene sesión", async () => {
    const database = await migratedDatabase();

    const policy = await database.query(
      `select policyname || ' ' || cmd || ' ' || coalesce(qual, '-')
         from pg_policies
        where schemaname = 'public'
          and tablename = 'registration_requests'`,
    );

    expect(policy).toBe("registration_requests_select_denied SELECT false");
  });

  it.each(["anon", "authenticated"])(
    "no le deja a %s ningún privilegio, ni siquiera truncate",
    async (grantee) => {
      const database = await migratedDatabase();

      expect(await privilegesOf(database, grantee)).toEqual([]);
    },
  );

  it("le deja al servidor leer y anotar peticiones", async () => {
    const database = await migratedDatabase();

    expect(await privilegesOf(database, "service_role")).toEqual(
      expect.arrayContaining(["INSERT", "SELECT"]),
    );
  });
});
