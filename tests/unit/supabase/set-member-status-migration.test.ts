import { expect, it } from "vitest";
import {
  type TemporaryDatabase,
  applyRepositoryMigrations,
  describeConPostgres,
  migratedDatabase,
} from "../../support/postgres";

/**
 * `public.set_member_status` contra un Postgres desechable (#244, RF-6 del
 * PRD de E5). Lo que no puede depender de que la aplicación se porte bien: el
 * club nunca se queda sin un Admin activo, ni por una baja ni por una baja y
 * una degradación que llegan a la vez, y la baja no borra el historial.
 */

const SET_STATUS = "public.set_member_status(uuid, uuid, uuid, text)";

/** Cuánto retiene el primer cambio su transacción abierta, para que el
 * segundo llegue seguro mientras las filas Admin siguen bloqueadas. */
const CONCURRENT_CHANGE_HOLD_SECONDS = 2;

async function seededClubId(database: TemporaryDatabase): Promise<string> {
  return database.query(
    "select id from public.clubs where slug = 'victoria-seadragons'",
  );
}

type SeedOptions = {
  readonly role: string;
  readonly status?: string;
  readonly clubId?: string;
};

async function seedMember(
  database: TemporaryDatabase,
  options: SeedOptions,
): Promise<string> {
  const club = options.clubId ?? (await seededClubId(database));
  const userId = await database.query(
    "insert into auth.users (id) values (gen_random_uuid()) returning id",
  );
  await database.query(
    `insert into public.members
       (club_id, user_id, full_name, email, role, account_status)
     values ('${club}', '${userId}', 'Socio de prueba',
             '${userId}@example.test', '${options.role}',
             '${options.status ?? "active"}')`,
  );
  return userId;
}

type StatusChange = {
  readonly clubId: string;
  readonly actorId: string;
  readonly targetId: string;
  readonly newStatus: string;
};

function statusSql(change: StatusChange): string {
  return `select public.set_member_status(
            '${change.targetId}', '${change.clubId}', '${change.actorId}',
            '${change.newStatus}')`;
}

function roleSql(change: {
  readonly clubId: string;
  readonly actorId: string;
  readonly targetId: string;
}): string {
  return `select public.change_member_role(
            '${change.targetId}', '${change.clubId}', '${change.actorId}',
            'Player')`;
}

function lastRow(output: string): string {
  const rows = output
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !/^(SET|BEGIN|COMMIT)$/.test(line));
  return rows[rows.length - 1] ?? "";
}

async function setStatus(
  database: TemporaryDatabase,
  change: StatusChange,
): Promise<Record<string, unknown>> {
  const output = await database.query(
    `set role service_role; ${statusSql(change)}`,
  );
  return JSON.parse(lastRow(output)) as Record<string, unknown>;
}

async function memberStatus(
  database: TemporaryDatabase,
  userId: string,
): Promise<string> {
  return database.query(
    `select account_status from public.members where user_id = '${userId}'`,
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
      where p.oid = '${SET_STATUS}'::regprocedure
        and case when a.grantee = 0 then 'PUBLIC'
                 else pg_get_userbyid(a.grantee) end = '${grantee}'
      order by a.privilege_type`,
  );
  return rows === "" ? [] : rows.split("\n");
}

/** Un club con un Admin y un socio con `targetRole` y `targetStatus`. */
async function adminAndMember(
  database: TemporaryDatabase,
  target: { readonly role: string; readonly status?: string },
): Promise<{ clubId: string; adminId: string; targetId: string }> {
  const clubId = await seededClubId(database);
  const adminId = await seedMember(database, { role: "Admin" });
  const targetId = await seedMember(database, target);
  return { clubId, adminId, targetId };
}

describeConPostgres("dar de baja y reactivar en la base", () => {
  it("da de baja a un socio activo y devuelve el estado anterior y el nuevo", async () => {
    const database = await migratedDatabase();
    const { clubId, adminId, targetId } = await adminAndMember(database, {
      role: "Player",
    });

    const outcome = await setStatus(database, {
      clubId,
      actorId: adminId,
      targetId,
      newStatus: "inactive",
    });

    expect(outcome).toEqual({
      outcome: "changed",
      user_id: targetId,
      previous_status: "active",
      new_status: "inactive",
    });
    expect(await memberStatus(database, targetId)).toBe("inactive");
  });

  it("da de baja a quien todavía no terminó su registro", async () => {
    const database = await migratedDatabase();
    const { clubId, adminId, targetId } = await adminAndMember(database, {
      role: "Player",
      status: "incomplete",
    });

    const outcome = await setStatus(database, {
      clubId,
      actorId: adminId,
      targetId,
      newStatus: "inactive",
    });

    expect(outcome).toMatchObject({
      outcome: "changed",
      previous_status: "incomplete",
    });
  });

  it.each(["active", "incomplete"])(
    "reactiva a un socio de baja con el estado %s que le toca",
    async (newStatus) => {
      const database = await migratedDatabase();
      const { clubId, adminId, targetId } = await adminAndMember(database, {
        role: "Player",
        status: "inactive",
      });

      const outcome = await setStatus(database, {
        clubId,
        actorId: adminId,
        targetId,
        newStatus,
      });

      expect(outcome).toEqual({
        outcome: "changed",
        user_id: targetId,
        previous_status: "inactive",
        new_status: newStatus,
      });
      expect(await memberStatus(database, targetId)).toBe(newStatus);
    },
  );

  it.each([
    ["dar de baja a quien ya está de baja", "inactive", "inactive"],
    ["reactivar a quien está activo", "active", "active"],
    ["reactivar a quien está activo como incompleto", "active", "incomplete"],
    ["reactivar a quien no terminó su registro", "incomplete", "active"],
  ])("no escribe nada al %s", async (_label, currentStatus, newStatus) => {
    const database = await migratedDatabase();
    const { clubId, adminId, targetId } = await adminAndMember(database, {
      role: "Player",
      status: currentStatus,
    });

    const outcome = await setStatus(database, {
      clubId,
      actorId: adminId,
      targetId,
      newStatus,
    });

    expect(outcome).toEqual({ outcome: "unchanged", status: currentStatus });
    expect(await memberStatus(database, targetId)).toBe(currentStatus);
  });

  it("no encuentra al socio de otro club, y no lo toca", async () => {
    const database = await migratedDatabase();
    const { clubId, adminId } = await adminAndMember(database, {
      role: "Player",
    });
    const otherClubId = await database.query(
      `insert into public.clubs (name, slug) values ('Otro club', 'otro-club')
       returning id`,
    );
    const outsiderId = await seedMember(database, {
      role: "Player",
      clubId: otherClubId,
    });

    const outcome = await setStatus(database, {
      clubId,
      actorId: adminId,
      targetId: outsiderId,
      newStatus: "inactive",
    });

    expect(outcome).toEqual({ outcome: "not_found" });
    expect(await memberStatus(database, outsiderId)).toBe("active");
  });

  it("no encuentra un socio que no existe", async () => {
    const database = await migratedDatabase();
    const { clubId, adminId } = await adminAndMember(database, {
      role: "Player",
    });

    const outcome = await setStatus(database, {
      clubId,
      actorId: adminId,
      targetId: "00000000-0000-4000-8000-000000000000",
      newStatus: "inactive",
    });

    expect(outcome).toEqual({ outcome: "not_found" });
  });

  it("no deja dar de baja al último Admin, y dice en qué estado estaba", async () => {
    const database = await migratedDatabase();
    const clubId = await seededClubId(database);
    const adminId = await seedMember(database, { role: "Admin" });

    const outcome = await setStatus(database, {
      clubId,
      actorId: adminId,
      targetId: adminId,
      newStatus: "inactive",
    });

    expect(outcome).toEqual({
      outcome: "last_admin",
      previous_status: "active",
    });
    expect(await memberStatus(database, adminId)).toBe("active");
  });

  it("un Admin de baja no salva al último Admin activo", async () => {
    const database = await migratedDatabase();
    const clubId = await seededClubId(database);
    const adminId = await seedMember(database, { role: "Admin" });
    await seedMember(database, { role: "Admin", status: "inactive" });

    const outcome = await setStatus(database, {
      clubId,
      actorId: adminId,
      targetId: adminId,
      newStatus: "inactive",
    });

    expect(outcome).toMatchObject({ outcome: "last_admin" });
  });

  it("con otro Admin activo, no deja que un Admin se dé de baja a sí mismo", async () => {
    const database = await migratedDatabase();
    const clubId = await seededClubId(database);
    const adminId = await seedMember(database, { role: "Admin" });
    await seedMember(database, { role: "Admin" });

    const outcome = await setStatus(database, {
      clubId,
      actorId: adminId,
      targetId: adminId,
      newStatus: "inactive",
    });

    expect(outcome).toEqual({ outcome: "self_deactivation" });
    expect(await memberStatus(database, adminId)).toBe("active");
  });

  it("con dos Admin activos, uno da de baja al otro", async () => {
    const database = await migratedDatabase();
    const clubId = await seededClubId(database);
    const adminId = await seedMember(database, { role: "Admin" });
    const otherAdminId = await seedMember(database, { role: "Admin" });

    const outcome = await setStatus(database, {
      clubId,
      actorId: adminId,
      targetId: otherAdminId,
      newStatus: "inactive",
    });

    expect(outcome).toMatchObject({ outcome: "changed" });
    expect(await memberStatus(database, otherAdminId)).toBe("inactive");
  });

  it.each([
    ["no es Admin", { role: "Coach" }],
    ["es un Admin de baja", { role: "Admin", status: "inactive" }],
  ])("no deja cambiar estados a quien %s", async (_label, actor) => {
    const database = await migratedDatabase();
    const clubId = await seededClubId(database);
    await seedMember(database, { role: "Admin" });
    const actorId = await seedMember(database, actor);
    const playerId = await seedMember(database, { role: "Player" });

    const outcome = await setStatus(database, {
      clubId,
      actorId,
      targetId: playerId,
      newStatus: "inactive",
    });

    expect(outcome).toEqual({ outcome: "actor_not_admin" });
    expect(await memberStatus(database, playerId)).toBe("active");
  });

  it.each(["Inactive", "deleted", ""])(
    "rechaza el estado %j sin tocar la fila",
    async (newStatus) => {
      const database = await migratedDatabase();
      const { clubId, adminId, targetId } = await adminAndMember(database, {
        role: "Player",
      });

      const result = await database.attempt(
        `set role service_role; ${statusSql({ clubId, actorId: adminId, targetId, newStatus })}`,
      );

      expect(result.code).not.toBe(0);
      expect(await memberStatus(database, targetId)).toBe("active");
    },
  );

  it("conserva sus solicitudes y sus grupos al darlo de baja", async () => {
    const database = await migratedDatabase();
    const { clubId, adminId, targetId } = await adminAndMember(database, {
      role: "Player",
    });
    const requestId = await database.query(
      `insert into public.role_requests (club_id, user_id, requested_role)
       values ('${clubId}', '${targetId}', 'Coach') returning id`,
    );
    const groupId = await database.query(
      `insert into public.groups (club_id, name) values ('${clubId}', 'Martes')
       returning id`,
    );
    await database.query(
      `insert into public.group_memberships (club_id, group_id, user_id)
       values ('${clubId}', '${groupId}', '${targetId}')`,
    );

    await setStatus(database, {
      clubId,
      actorId: adminId,
      targetId,
      newStatus: "inactive",
    });

    expect(
      await database.query(
        `select status from public.role_requests where id = '${requestId}'`,
      ),
    ).toBe("pending");
    expect(
      await database.query(
        `select count(*) from public.group_memberships
          where user_id = '${targetId}'`,
      ),
    ).toBe("1");
  });

  it("una baja y una degradación simultáneas de los dos Admin dejan uno activo", async () => {
    const database = await migratedDatabase();
    const clubId = await seededClubId(database);
    const firstAdminId = await seedMember(database, { role: "Admin" });
    const secondAdminId = await seedMember(database, { role: "Admin" });

    const first = database.attempt(
      `begin; set local role service_role;
       ${statusSql({ clubId, actorId: firstAdminId, targetId: secondAdminId, newStatus: "inactive" })};
       select pg_sleep(${CONCURRENT_CHANGE_HOLD_SECONDS}); commit;`,
    );
    // Deja que la baja tome el bloqueo antes de lanzar la degradación.
    await new Promise((resolve) => setTimeout(resolve, 500));
    const second = await database.attempt(
      `set role service_role; ${roleSql({ clubId, actorId: firstAdminId, targetId: firstAdminId })}`,
    );
    const firstResult = await first;

    expect(firstResult.code, firstResult.stderr).toBe(0);
    expect(second.code, second.stderr).toBe(0);
    expect(JSON.parse(lastRow(second.stdout))).toEqual({
      outcome: "last_admin",
    });
    expect(
      await database.query(
        `select count(*) from public.members
          where club_id = '${clubId}' and role = 'Admin'
            and account_status <> 'inactive'`,
      ),
    ).toBe("1");
  });
});

describeConPostgres("change_member_role con socios de baja", () => {
  it("no cuenta a un Admin de baja para salvar al último Admin activo", async () => {
    const database = await migratedDatabase();
    const clubId = await seededClubId(database);
    const adminId = await seedMember(database, { role: "Admin" });
    await seedMember(database, { role: "Admin", status: "inactive" });

    const output = await database.query(
      `set role service_role; ${roleSql({ clubId, actorId: adminId, targetId: adminId })}`,
    );

    expect(JSON.parse(lastRow(output))).toEqual({ outcome: "last_admin" });
  });

  it("deja degradar a un Admin de baja aunque quede un solo Admin activo", async () => {
    const database = await migratedDatabase();
    const clubId = await seededClubId(database);
    const adminId = await seedMember(database, { role: "Admin" });
    const inactiveAdminId = await seedMember(database, {
      role: "Admin",
      status: "inactive",
    });

    const output = await database.query(
      `set role service_role; ${roleSql({ clubId, actorId: adminId, targetId: inactiveAdminId })}`,
    );

    expect(JSON.parse(lastRow(output))).toMatchObject({ outcome: "changed" });
  });

  it("no deja cambiar roles a un Admin de baja", async () => {
    const database = await migratedDatabase();
    const clubId = await seededClubId(database);
    await seedMember(database, { role: "Admin" });
    const inactiveAdminId = await seedMember(database, {
      role: "Admin",
      status: "inactive",
    });
    const coachId = await seedMember(database, { role: "Coach" });

    const output = await database.query(
      `set role service_role; ${roleSql({ clubId, actorId: inactiveAdminId, targetId: coachId })}`,
    );

    expect(JSON.parse(lastRow(output))).toEqual({
      outcome: "actor_not_admin",
    });
  });
});

describeConPostgres("privilegios de set_member_status", () => {
  it("sólo la llave de servicio puede ejecutarla", async () => {
    const database = await migratedDatabase();

    expect(await functionPrivilegesOf(database, "service_role")).toEqual([
      "EXECUTE",
    ]);
    expect(await functionPrivilegesOf(database, "PUBLIC")).toEqual([]);
    expect(await functionPrivilegesOf(database, "anon")).toEqual([]);
    expect(await functionPrivilegesOf(database, "authenticated")).toEqual([]);
  });

  it("un socio con sesión no puede reactivarse llamándola directamente", async () => {
    const database = await migratedDatabase();
    const { clubId, adminId, targetId } = await adminAndMember(database, {
      role: "Player",
      status: "inactive",
    });

    const result = await database.attempt(
      `set role authenticated;
       set request.jwt.claims = '{"sub":"${targetId}"}';
       ${statusSql({ clubId, actorId: adminId, targetId, newStatus: "active" })}`,
    );

    expect(result.code).not.toBe(0);
    expect(result.stderr).toMatch(/permission denied/);
    expect(await memberStatus(database, targetId)).toBe("inactive");
  });

  it("corre como definer con un search_path vacío", async () => {
    const database = await migratedDatabase();

    const attributes = await database.query(
      `select prosecdef::text || ' ' || proconfig::text
         from pg_proc where oid = '${SET_STATUS}'::regprocedure`,
    );

    expect(attributes).toBe('true {"search_path=\\"\\""}');
  });
});

describeConPostgres("migración 0017", () => {
  it("es idempotente: aplicada dos veces no falla ni cambia el esquema", async () => {
    const database = await migratedDatabase();
    const afterFirst = await database.snapshot();

    const second = await applyRepositoryMigrations(database);

    expect(second.code, second.stderr).toBe(0);
    expect(afterFirst).toMatch(/funcion set_member_status\(/);
    expect(await database.snapshot()).toBe(afterFirst);
  });
});
