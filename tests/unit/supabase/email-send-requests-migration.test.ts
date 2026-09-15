import { expect, it } from "vitest";
import {
  type TemporaryDatabase,
  describeConPostgres,
  migratedDatabase,
} from "../../support/postgres";

/**
 * `public.email_send_requests` contra un Postgres desechable. Es el cupo propio
 * del envío (#154): si la llave anónima pudiera vaciarla, cualquiera
 * devolvería el aviso de "no podemos mandar correos" a verde desde el
 * navegador, y si pudiera llenarla, lo encendería para todos.
 */

async function privilegesOf(
  database: TemporaryDatabase,
  grantee: string,
): Promise<string[]> {
  const rows = await database.query(
    `select privilege_type
       from information_schema.role_table_grants
      where table_schema = 'public'
        and table_name = 'email_send_requests'
        and grantee = '${grantee}'
      order by privilege_type`,
  );
  return rows === "" ? [] : rows.split("\n");
}

describeConPostgres("migración del cupo propio de correos", () => {
  it("guarda sólo el club y el instante: ni el correo ni su hash", async () => {
    const database = await migratedDatabase();

    const columns = await database.query(
      `select column_name || ' ' || data_type || ' null=' || is_nullable
         from information_schema.columns
        where table_schema = 'public'
          and table_name = 'email_send_requests'
        order by column_name`,
    );

    expect(columns.split("\n")).toEqual([
      "club_id uuid null=NO",
      "id uuid null=NO",
      "requested_at timestamp with time zone null=NO",
    ]);
  });

  it("nace con RLS activo", async () => {
    const database = await migratedDatabase();

    const rls = await database.query(
      `select relrowsecurity from pg_class
        where oid = 'public.email_send_requests'::regclass`,
    );

    expect(rls).toBe("t");
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
