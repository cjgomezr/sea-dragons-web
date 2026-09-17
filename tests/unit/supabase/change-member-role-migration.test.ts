import { expect, it } from "vitest";
import {
  type TemporaryDatabase,
  applyRepositoryMigrations,
  describeConPostgres,
  migratedDatabase,
} from "../../support/postgres";

/**
 * `public.change_member_role` contra un Postgres desechable (#211, RF-6 y
 * RF-7 del PRD de E3). Lo que no puede depender de que la aplicación se porte
 * bien: el club nunca se queda sin Admin, tampoco con dos degradaciones que
 * llegan a la vez.
 */

const CHANGE = "public.change_member_role(uuid, uuid, uuid, text)";

/** Cuánto retiene el primer cambio su transacción abierta, para que el
 * segundo llegue seguro mientras las filas Admin siguen bloqueadas. */
const CONCURRENT_CHANGE_HOLD_SECONDS = 2;

/** Lo mínimo que tiene que tardar el segundo cambio para que conste que
 * esperó al primero. La mitad del tiempo retenido deja margen a psql. */
const MIN_BLOCKED_MILLISECONDS = (CONCURRENT_CHANGE_HOLD_SECONDS * 1000) / 2;

async function seededClubId(database: TemporaryDatabase): Promise<string> {
  return database.query(
    "select id from public.clubs where slug = 'victoria-seadragons'",
  );
}

async function seedMember(
  database: TemporaryDatabase,
  role: string,
  clubId?: string,
): Promise<string> {
  const club = clubId ?? (await seededClubId(database));
  const userId = await database.query(
    "insert into auth.users (id) values (gen_random_uuid()) returning id",
  );
  await database.query(
    `insert into public.members (club_id, user_id, full_name, email, role)
     values ('${club}', '${userId}', 'Socio de prueba',
             '${userId}@example.test', '${role}')`,
  );
  return userId;
}

type RoleChange = {
  readonly clubId: string;
  readonly actorId: string;
  readonly targetId: string;
  readonly newRole: string;
};

function changeSql(change: RoleChange): string {
  return `select public.change_member_role(
            '${change.targetId}', '${change.clubId}', '${change.actorId}',
            '${change.newRole}')`;
}

function lastRow(output: string): string {
  const rows = output
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !/^(SET|BEGIN|COMMIT)$/.test(line));
  return rows[rows.length - 1] ?? "";
}

async function changeRole(
  database: TemporaryDatabase,
  change: RoleChange,
): Promise<Record<string, unknown>> {
  const output = await database.query(
    `set role service_role; ${changeSql(change)}`,
  );
  return JSON.parse(lastRow(output)) as Record<string, unknown>;
}

async function memberRole(
  database: TemporaryDatabase,
  userId: string,
): Promise<string> {
  return database.query(
    `select role from public.members where user_id = '${userId}'`,
  );
}

async function functionPrivilegesOf(
  database: TemporaryDatabase,
  grantee: string,
): Promise<string[]> {
  const rows = await database.query(
    `select a.privilege_type
       from pg_proc p
       cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
      where p.oid = '${CHANGE}'::regprocedure
        and case when a.grantee = 0 then 'PUBLIC'
                 else pg_get_userbyid(a.grantee) end = '${grantee}'
      order by a.privilege_type`,
  );
  return rows === "" ? [] : rows.split("\n");
}

/** Un club con un Admin y un socio con `targetRole`. */
async function adminAndMember(
  database: TemporaryDatabase,
  targetRole: string,
): Promise<{ clubId: string; adminId: string; targetId: string }> {
  const clubId = await seededClubId(database);
  const adminId = await seedMember(database, "Admin");
  const targetId = await seedMember(database, targetRole);
  return { clubId, adminId, targetId };
}

describeConPostgres("cambiar el rol de un socio en la base", () => {
  it("cambia el rol y devuelve el anterior y el nuevo", async () => {
    const database = await migratedDatabase();
    const { clubId, adminId, targetId } = await adminAndMember(
      database,
      "Player",
    );

    const outcome = await changeRole(database, {
      clubId,
      actorId: adminId,
      targetId,
      newRole: "Committee",
    });

    expect(outcome).toEqual({
      outcome: "changed",
      user_id: targetId,
      previous_role: "Player",
      new_role: "Committee",
    });
    expect(await memberRole(database, targetId)).toBe("Committee");
  });

  it.each(["Admin", "Committee", "Player"])(
    "pone %s a un Coach",
    async (newRole) => {
      const database = await migratedDatabase();
      const { clubId, adminId, targetId } = await adminAndMember(
        database,
        "Coach",
      );

      const outcome = await changeRole(database, {
        clubId,
        actorId: adminId,
        targetId,
        newRole,
      });

      expect(outcome).toMatchObject({ outcome: "changed", new_role: newRole });
      expect(await memberRole(database, targetId)).toBe(newRole);
    },
  );

  it("no escribe nada si el socio ya tiene ese rol", async () => {
    const database = await migratedDatabase();
    const { clubId, adminId, targetId } = await adminAndMember(
      database,
      "Coach",
    );
    // Cualquier escritura en la fila haría fallar la llamada.
    await database.query(
      `create function public.falla_si_escribe() returns trigger
         language plpgsql as $$ begin raise exception 'escribió'; end $$;
       create trigger falla_si_escribe before update on public.members
         for each row execute function public.falla_si_escribe();`,
    );

    const outcome = await changeRole(database, {
      clubId,
      actorId: adminId,
      targetId,
      newRole: "Coach",
    });

    expect(outcome).toEqual({ outcome: "unchanged", role: "Coach" });
  });

  it("no encuentra un socio que no existe", async () => {
    const database = await migratedDatabase();
    const { clubId, adminId } = await adminAndMember(database, "Player");

    const outcome = await changeRole(database, {
      clubId,
      actorId: adminId,
      targetId: "00000000-0000-4000-8000-000000000000",
      newRole: "Coach",
    });

    expect(outcome).toEqual({ outcome: "not_found" });
  });

  it("no encuentra al socio de otro club, y no lo toca", async () => {
    const database = await migratedDatabase();
    const { clubId, adminId } = await adminAndMember(database, "Player");
    const otherClubId = await database.query(
      `insert into public.clubs (name, slug) values ('Otro club', 'otro-club')
       returning id`,
    );
    const outsiderId = await seedMember(database, "Player", otherClubId);

    const outcome = await changeRole(database, {
      clubId,
      actorId: adminId,
      targetId: outsiderId,
      newRole: "Coach",
    });

    expect(outcome).toEqual({ outcome: "not_found" });
    expect(await memberRole(database, outsiderId)).toBe("Player");
  });

  it("no deja que el último Admin se degrade a sí mismo", async () => {
    const database = await migratedDatabase();
    const clubId = await seededClubId(database);
    const adminId = await seedMember(database, "Admin");

    const outcome = await changeRole(database, {
      clubId,
      actorId: adminId,
      targetId: adminId,
      newRole: "Player",
    });

    expect(outcome).toEqual({ outcome: "last_admin" });
    expect(await memberRole(database, adminId)).toBe("Admin");
  });

  it("no deja que otra persona degrade al último Admin", async () => {
    const database = await migratedDatabase();
    const { clubId, adminId, targetId } = await adminAndMember(
      database,
      "Committee",
    );

    const outcome = await changeRole(database, {
      clubId,
      actorId: targetId,
      targetId: adminId,
      newRole: "Coach",
    });

    expect(outcome).toEqual({ outcome: "last_admin" });
    expect(await memberRole(database, adminId)).toBe("Admin");
  });

  it("cuenta sólo los Admin del club: el de otro club no salva al último", async () => {
    const database = await migratedDatabase();
    const clubId = await seededClubId(database);
    const adminId = await seedMember(database, "Admin");
    const otherClubId = await database.query(
      `insert into public.clubs (name, slug) values ('Otro club', 'otro-club')
       returning id`,
    );
    await seedMember(database, "Admin", otherClubId);

    const outcome = await changeRole(database, {
      clubId,
      actorId: adminId,
      targetId: adminId,
      newRole: "Player",
    });

    expect(outcome).toEqual({ outcome: "last_admin" });
  });

  it.each([
    ["a otro Admin", false],
    ["a sí mismo", true],
  ])(
    "con dos Admin, uno se deja degradar %s",
    async (_label, isSelfDemotion) => {
      const database = await migratedDatabase();
      const clubId = await seededClubId(database);
      const firstAdminId = await seedMember(database, "Admin");
      const secondAdminId = await seedMember(database, "Admin");
      const targetId = isSelfDemotion ? firstAdminId : secondAdminId;

      const outcome = await changeRole(database, {
        clubId,
        actorId: firstAdminId,
        targetId,
        newRole: "Player",
      });

      expect(outcome).toMatchObject({
        outcome: "changed",
        previous_role: "Admin",
      });
      expect(await memberRole(database, targetId)).toBe("Player");
    },
  );

  it("no deja cambiar roles a quien ya no es Admin del club", async () => {
    const database = await migratedDatabase();
    const clubId = await seededClubId(database);
    await seedMember(database, "Admin");
    const coachId = await seedMember(database, "Coach");
    const playerId = await seedMember(database, "Player");

    const outcome = await changeRole(database, {
      clubId,
      actorId: coachId,
      targetId: playerId,
      newRole: "Admin",
    });

    expect(outcome).toEqual({ outcome: "actor_not_admin" });
    expect(await memberRole(database, playerId)).toBe("Player");
  });

  it.each(["admin", "Owner", ""])(
    "rechaza el rol %j sin tocar la fila",
    async (newRole) => {
      const database = await migratedDatabase();
      const { clubId, adminId, targetId } = await adminAndMember(
        database,
        "Player",
      );

      const result = await database.attempt(
        `set role service_role; ${changeSql({ clubId, actorId: adminId, targetId, newRole })}`,
      );

      expect(result.code).not.toBe(0);
      expect(await memberRole(database, targetId)).toBe("Player");
    },
  );

  it("deja pendiente la solicitud de rol del socio", async () => {
    const database = await migratedDatabase();
    const { clubId, adminId, targetId } = await adminAndMember(
      database,
      "Player",
    );
    const requestId = await database.query(
      `insert into public.role_requests (club_id, user_id, requested_role)
       values ('${clubId}', '${targetId}', 'Coach') returning id`,
    );

    await changeRole(database, {
      clubId,
      actorId: adminId,
      targetId,
      newRole: "Committee",
    });

    expect(
      await database.query(
        `select status from public.role_requests where id = '${requestId}'`,
      ),
    ).toBe("pending");
  });

  it.each([
    ["se degradan el uno al otro", true],
    ["cada uno se degrada a sí mismo", false],
  ])(
    "con dos Admin que %s a la vez, sólo se aplica uno y el club conserva un Admin",
    async (_label, isCrossDemotion) => {
      const database = await migratedDatabase();
      const clubId = await seededClubId(database);
      const firstAdminId = await seedMember(database, "Admin");
      const secondAdminId = await seedMember(database, "Admin");
      const firstChange: RoleChange = {
        clubId,
        actorId: firstAdminId,
        targetId: isCrossDemotion ? secondAdminId : firstAdminId,
        newRole: "Player",
      };
      const secondChange: RoleChange = {
        clubId,
        actorId: secondAdminId,
        targetId: isCrossDemotion ? firstAdminId : secondAdminId,
        newRole: "Player",
      };

      const first = database.attempt(
        `begin; set local role service_role; ${changeSql(firstChange)};
         select pg_sleep(${CONCURRENT_CHANGE_HOLD_SECONDS}); commit;`,
      );
      // Deja que el primero tome el bloqueo antes de lanzar el segundo.
      await new Promise((resolve) => setTimeout(resolve, 500));
      const startedAt = performance.now();
      const second = await database.attempt(
        `set role service_role; ${changeSql(secondChange)}`,
      );
      const elapsed = performance.now() - startedAt;
      const firstResult = await first;

      expect(firstResult.code, firstResult.stderr).toBe(0);
      expect(second.code, second.stderr).toBe(0);
      expect(JSON.parse(lastRow(second.stdout))).toEqual({
        outcome: "last_admin",
      });
      expect(elapsed).toBeGreaterThanOrEqual(MIN_BLOCKED_MILLISECONDS);
      expect(
        await database.query(
          `select count(*) from public.members
            where club_id = '${clubId}' and role = 'Admin'`,
        ),
      ).toBe("1");
      expect(await memberRole(database, firstChange.targetId)).toBe("Player");
    },
  );
});

describeConPostgres("privilegios de change_member_role", () => {
  it("sólo la llave de servicio puede ejecutarla", async () => {
    const database = await migratedDatabase();

    expect(await functionPrivilegesOf(database, "service_role")).toEqual([
      "EXECUTE",
    ]);
    expect(await functionPrivilegesOf(database, "PUBLIC")).toEqual([]);
    expect(await functionPrivilegesOf(database, "anon")).toEqual([]);
    expect(await functionPrivilegesOf(database, "authenticated")).toEqual([]);
  });

  it("un socio con sesión no puede cambiarse el rol llamándola directamente", async () => {
    const database = await migratedDatabase();
    const { clubId, adminId, targetId } = await adminAndMember(
      database,
      "Player",
    );

    const result = await database.attempt(
      `set role authenticated;
       set request.jwt.claims = '{"sub":"${targetId}"}';
       ${changeSql({ clubId, actorId: adminId, targetId, newRole: "Admin" })}`,
    );

    expect(result.code).not.toBe(0);
    expect(result.stderr).toMatch(/permission denied/);
    expect(await memberRole(database, targetId)).toBe("Player");
  });

  it("corre como definer con un search_path vacío", async () => {
    const database = await migratedDatabase();

    const attributes = await database.query(
      `select prosecdef::text || ' ' || proconfig::text
         from pg_proc where oid = '${CHANGE}'::regprocedure`,
    );

    expect(attributes).toBe('true {"search_path=\\"\\""}');
  });
});

describeConPostgres("migración 0014", () => {
  it("es idempotente: aplicada dos veces no falla ni cambia el esquema", async () => {
    const database = await migratedDatabase();
    const afterFirst = await database.snapshot();

    const second = await applyRepositoryMigrations(database);

    expect(second.code, second.stderr).toBe(0);
    expect(afterFirst).toMatch(/funcion change_member_role\(/);
    expect(await database.snapshot()).toBe(afterFirst);
  });
});
