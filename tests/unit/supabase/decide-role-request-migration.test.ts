import { expect, it } from "vitest";
import {
  type RunResult,
  type TemporaryDatabase,
  applyRepositoryMigrations,
  describeConPostgres,
  migratedDatabase,
} from "../../support/postgres";

/**
 * `public.decide_role_request` contra un Postgres desechable (#210, RF-5 del
 * PRD de E3). Lo que no puede depender de que la aplicación se porte bien:
 * aprobar cambia la solicitud y el rol en la misma transacción, y dos
 * decisiones simultáneas sobre la misma solicitud dejan aplicada una sola.
 */

const DECIDE = "public.decide_role_request(uuid, uuid, uuid, text)";

/** Cuánto retiene la primera decisión su transacción abierta, para que la
 * segunda llegue seguro mientras la fila sigue bloqueada. */
const CONCURRENT_DECISION_HOLD_SECONDS = 2;

/** Lo mínimo que tiene que tardar la segunda decisión para que conste que
 * esperó a la primera. La mitad del tiempo retenido deja margen a psql. */
const MIN_BLOCKED_MILLISECONDS = (CONCURRENT_DECISION_HOLD_SECONDS * 1000) / 2;

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

async function seedPendingRequest(
  database: TemporaryDatabase,
  userId: string,
  requestedRole = "Coach",
): Promise<string> {
  return database.query(
    `insert into public.role_requests (club_id, user_id, requested_role)
     select club_id, user_id, '${requestedRole}' from public.members
      where user_id = '${userId}'
     returning id`,
  );
}

type Scenario = {
  readonly clubId: string;
  readonly adminId: string;
  readonly memberId: string;
  readonly requestId: string;
};

async function scenario(
  database: TemporaryDatabase,
  memberRole = "Player",
): Promise<Scenario> {
  const clubId = await seededClubId(database);
  const adminId = await seedMember(database, "Admin");
  const memberId = await seedMember(database, memberRole);
  const requestId = await seedPendingRequest(database, memberId);
  return { clubId, adminId, memberId, requestId };
}

function decideSql(
  target: Scenario,
  decision: string,
  clubId: string = target.clubId,
): string {
  return `select public.decide_role_request(
            '${target.requestId}', '${clubId}', '${target.adminId}', '${decision}')`;
}

async function decide(
  database: TemporaryDatabase,
  target: Scenario,
  decision: string,
  clubId?: string,
): Promise<Record<string, unknown>> {
  const output = await database.query(
    `set role service_role; ${decideSql(target, decision, clubId)}`,
  );
  return JSON.parse(lastRow(output)) as Record<string, unknown>;
}

function lastRow(output: string): string {
  const rows = output
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !/^(SET|BEGIN|COMMIT)$/.test(line));
  return rows[rows.length - 1] ?? "";
}

async function requestState(
  database: TemporaryDatabase,
  requestId: string,
): Promise<string> {
  return database.query(
    `select status || ' ' || coalesce(decided_by::text, '-') || ' '
            || (decided_at is not null)::text
       from public.role_requests where id = '${requestId}'`,
  );
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
      where p.oid = '${DECIDE}'::regprocedure
        and case when a.grantee = 0 then 'PUBLIC'
                 else pg_get_userbyid(a.grantee) end = '${grantee}'
      order by a.privilege_type`,
  );
  return rows === "" ? [] : rows.split("\n");
}

describeConPostgres("decidir una solicitud de rol en la base", () => {
  it("al aprobar cambia la solicitud y el rol del socio en la misma llamada", async () => {
    const database = await migratedDatabase();
    const target = await scenario(database);

    const outcome = await decide(database, target, "approved");

    expect(outcome).toMatchObject({
      outcome: "approved",
      id: target.requestId,
      decided_by: target.adminId,
      user_id: target.memberId,
      previous_role: "Player",
      new_role: "Coach",
    });
    expect(typeof outcome.decided_at).toBe("string");
    expect(await requestState(database, target.requestId)).toBe(
      `approved ${target.adminId} true`,
    );
    expect(await memberRole(database, target.memberId)).toBe("Coach");
  });

  it("al rechazar cambia sólo la solicitud", async () => {
    const database = await migratedDatabase();
    const target = await scenario(database);

    const outcome = await decide(database, target, "rejected");

    expect(outcome).toMatchObject({
      outcome: "rejected",
      id: target.requestId,
      decided_by: target.adminId,
    });
    expect(await requestState(database, target.requestId)).toBe(
      `rejected ${target.adminId} true`,
    );
    expect(await memberRole(database, target.memberId)).toBe("Player");
  });

  it("al rechazar dice a quién avisar y qué rol había pedido (#267)", async () => {
    const database = await migratedDatabase();
    const target = await scenario(database);

    const outcome = await decide(database, target, "rejected");

    expect(outcome).toMatchObject({
      user_id: target.memberId,
      requested_role: "Coach",
    });
  });

  it("no pisa una decisión ya tomada y dice cuál fue", async () => {
    const database = await migratedDatabase();
    const target = await scenario(database);
    await decide(database, target, "rejected");

    const outcome = await decide(database, target, "approved");

    expect(outcome).toEqual({ outcome: "already_decided", status: "rejected" });
    expect(await requestState(database, target.requestId)).toMatch(
      /^rejected /,
    );
    expect(await memberRole(database, target.memberId)).toBe("Player");
  });

  it.each([
    ["el rol pedido", "Coach"],
    ["Admin", "Admin"],
  ])(
    "no aprueba a quien ya tiene %s y deja la solicitud pendiente",
    async (_label, currentRole) => {
      const database = await migratedDatabase();
      const clubId = await seededClubId(database);
      const adminId = await seedMember(database, "Admin");
      const memberId = await seedMember(database, "Player");
      const requestId = await seedPendingRequest(database, memberId);
      // El rol cambió por otra vía después de pedirlo.
      await database.query(
        `update public.members set role = '${currentRole}'
          where user_id = '${memberId}'`,
      );

      const outcome = await decide(
        database,
        { clubId, adminId, memberId, requestId },
        "approved",
      );

      expect(outcome).toEqual({ outcome: "role_already_granted" });
      expect(await requestState(database, requestId)).toBe("pending - false");
      expect(await memberRole(database, memberId)).toBe(currentRole);
    },
  );

  it("sí deja rechazar la solicitud de quien ya tiene el rol", async () => {
    const database = await migratedDatabase();
    const target = await scenario(database);
    await database.query(
      `update public.members set role = 'Coach'
        where user_id = '${target.memberId}'`,
    );

    const outcome = await decide(database, target, "rejected");

    expect(outcome).toMatchObject({ outcome: "rejected" });
  });

  it("no encuentra una solicitud que no existe", async () => {
    const database = await migratedDatabase();
    const target = await scenario(database);

    const outcome = await decide(
      database,
      { ...target, requestId: "00000000-0000-4000-8000-000000000000" },
      "approved",
    );

    expect(outcome).toEqual({ outcome: "not_found" });
  });

  it("no encuentra la solicitud de otro club, y no la toca", async () => {
    const database = await migratedDatabase();
    const target = await scenario(database);
    const otherClubId = await database.query(
      `insert into public.clubs (name, slug) values ('Otro club', 'otro-club')
       returning id`,
    );

    const outcome = await decide(database, target, "approved", otherClubId);

    expect(outcome).toEqual({ outcome: "not_found" });
    expect(await requestState(database, target.requestId)).toBe(
      "pending - false",
    );
  });

  it("rechaza una decisión que no es aprobar ni rechazar", async () => {
    const database = await migratedDatabase();
    const target = await scenario(database);

    const result: RunResult = await database.attempt(
      `set role service_role; ${decideSql(target, "pending")}`,
    );

    expect(result.code).not.toBe(0);
    expect(await requestState(database, target.requestId)).toBe(
      "pending - false",
    );
  });

  it("si el cambio de rol falla, la solicitud tampoco cambia", async () => {
    const database = await migratedDatabase();
    const target = await scenario(database);
    // Un fallo forzado justo en la segunda escritura de la aprobación.
    await database.query(
      `create function public.falla_cambio_de_rol() returns trigger
         language plpgsql as $$ begin raise exception 'fallo forzado'; end $$;
       create trigger falla_cambio_de_rol before update of role on public.members
         for each row execute function public.falla_cambio_de_rol();`,
    );

    const result = await database.attempt(
      `set role service_role; ${decideSql(target, "approved")}`,
    );

    expect(result.code).not.toBe(0);
    expect(await requestState(database, target.requestId)).toBe(
      "pending - false",
    );
    expect(await memberRole(database, target.memberId)).toBe("Player");
  });

  it("con dos decisiones a la vez, la segunda espera a la primera y no la pisa", async () => {
    const database = await migratedDatabase();
    const target = await scenario(database);

    const first = database.attempt(
      `begin; set local role service_role; ${decideSql(target, "approved")};
       select pg_sleep(${CONCURRENT_DECISION_HOLD_SECONDS}); commit;`,
    );
    // Deja que la primera tome el bloqueo antes de lanzar la segunda.
    await new Promise((resolve) => setTimeout(resolve, 500));
    const startedAt = performance.now();
    const second = await database.attempt(
      `set role service_role; ${decideSql(target, "rejected")}`,
    );
    const elapsed = performance.now() - startedAt;
    const firstResult = await first;

    expect(firstResult.code, firstResult.stderr).toBe(0);
    expect(second.code, second.stderr).toBe(0);
    expect(JSON.parse(lastRow(second.stdout))).toEqual({
      outcome: "already_decided",
      status: "approved",
    });
    expect(elapsed).toBeGreaterThanOrEqual(MIN_BLOCKED_MILLISECONDS);
    expect(await requestState(database, target.requestId)).toMatch(
      /^approved /,
    );
    expect(await memberRole(database, target.memberId)).toBe("Coach");
  });
});

describeConPostgres("privilegios de decide_role_request", () => {
  it("sólo la llave de servicio puede ejecutarla", async () => {
    const database = await migratedDatabase();

    expect(await functionPrivilegesOf(database, "service_role")).toEqual([
      "EXECUTE",
    ]);
    expect(await functionPrivilegesOf(database, "PUBLIC")).toEqual([]);
    expect(await functionPrivilegesOf(database, "anon")).toEqual([]);
    expect(await functionPrivilegesOf(database, "authenticated")).toEqual([]);
  });

  it("un socio con sesión no puede decidir llamándola directamente", async () => {
    const database = await migratedDatabase();
    const target = await scenario(database);

    const result = await database.attempt(
      `set role authenticated;
       set request.jwt.claims = '{"sub":"${target.adminId}"}';
       ${decideSql(target, "approved")}`,
    );

    expect(result.code).not.toBe(0);
    expect(result.stderr).toMatch(/permission denied/);
    expect(await requestState(database, target.requestId)).toBe(
      "pending - false",
    );
  });

  it("corre como definer con un search_path vacío", async () => {
    const database = await migratedDatabase();

    const attributes = await database.query(
      `select prosecdef::text || ' ' || proconfig::text
         from pg_proc where oid = '${DECIDE}'::regprocedure`,
    );

    expect(attributes).toBe('true {"search_path=\\"\\""}');
  });
});

describeConPostgres("migración 0013", () => {
  it("es idempotente: aplicada dos veces no falla ni cambia el esquema", async () => {
    const database = await migratedDatabase();
    const afterFirst = await database.snapshot();

    const second = await applyRepositoryMigrations(database);

    expect(second.code, second.stderr).toBe(0);
    expect(afterFirst).toMatch(/funcion decide_role_request\(/);
    expect(await database.snapshot()).toBe(afterFirst);
  });
});
