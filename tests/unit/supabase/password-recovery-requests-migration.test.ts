import { expect, it } from "vitest";
import {
  type TemporaryDatabase,
  describeConPostgres,
  migratedDatabase,
} from "../../support/postgres";

/**
 * `public.password_recovery_requests` contra un Postgres desechable. Es la
 * tabla que sostiene el límite de peticiones de recuperación de contraseña, así
 * que lo que se comprueba es que nadie más que el servidor la toca: si la
 * llave anónima pudiera vaciarla, el límite se desactivaría desde el navegador.
 */

async function privilegesOf(
  database: TemporaryDatabase,
  grantee: string,
): Promise<string[]> {
  const rows = await database.query(
    `select privilege_type
       from information_schema.role_table_grants
      where table_schema = 'public'
        and table_name = 'password_recovery_requests'
        and grantee = '${grantee}'
      order by privilege_type`,
  );
  return rows === "" ? [] : rows.split("\n");
}

describeConPostgres(
  "migración del límite de recuperación de contraseña",
  () => {
    it("guarda el hash del correo y el instante, nunca el correo", async () => {
      const database = await migratedDatabase();

      const columns = await database.query(
        `select column_name || ' ' || data_type || ' null=' || is_nullable
         from information_schema.columns
        where table_schema = 'public'
          and table_name = 'password_recovery_requests'
        order by column_name`,
      );

      expect(columns.split("\n")).toEqual([
        "club_id uuid null=NO",
        "email_hash text null=NO",
        "id uuid null=NO",
        "requested_at timestamp with time zone null=NO",
      ]);
    });

    it("nace con RLS activo", async () => {
      const database = await migratedDatabase();

      const rls = await database.query(
        `select relrowsecurity from pg_class
        where oid = 'public.password_recovery_requests'::regclass`,
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
  },
);
