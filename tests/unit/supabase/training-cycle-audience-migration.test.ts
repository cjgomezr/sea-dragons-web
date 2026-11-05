import { expect, it } from "vitest";
import {
  type TemporaryDatabase,
  applyRepositoryMigrations,
  databaseBeforeMigration,
  describeConPostgres,
  migratedDatabase,
} from "../../support/postgres";

/**
 * `0095_training_cycle_audience.sql` contra un Postgres desechable (#978, D1,
 * D2, D3, D8 y D9 del PRD de E38): cada ciclo es de todo el club o de grupos,
 * y como mucho hay un activo de todo el club y uno por grupo. Lo garantiza la
 * base, también con dos activaciones a la vez.
 */

const SEEDED_CLUB = "victoria-seadragons";
const MIGRATION_PREFIX = "0095";
/** Lo que la primera activación sostiene su transacción abierta. */
const HOLD_SECONDS = 2;
/** Lo que espera la segunda para llegar con la primera ya dentro. */
const SECOND_ACTIVATION_DELAY_MS = 500;
/** Aplicar el histórico dos veces pasa de los 20 s por defecto en Windows. */
const REAPPLY_TIMEOUT_MS = 90_000;

type Audience = "club" | "groups";

function rowsOf(output: string): string[] {
  return output.split("\n").filter((line) => line.trim() !== "");
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function seededClubId(database: TemporaryDatabase): Promise<string> {
  return database.query(
    `select id from public.clubs where slug = '${SEEDED_CLUB}'`,
  );
}

function createOtherClub(database: TemporaryDatabase): Promise<string> {
  return database.query(
    `insert into public.clubs (name, slug)
     values ('Otro club', 'otro-club-' || gen_random_uuid())
     returning id`,
  );
}

function seedGroup(
  database: TemporaryDatabase,
  clubId: string,
  name: string,
): Promise<string> {
  return database.query(
    `insert into public.groups (club_id, name)
     values ('${clubId}', '${name}') returning id`,
  );
}

function seedLegacyCycle(
  database: TemporaryDatabase,
  clubId: string,
  options: { readonly name: string; readonly status: string },
): Promise<string> {
  return database.query(
    `insert into public.training_cycles
       (club_id, name, start_date, weeks, status)
     values ('${clubId}', '${options.name}', '2026-11-16', 4,
             '${options.status}')
     returning id`,
  );
}

function uuidArray(ids: readonly string[]): string {
  return `array[${ids.map((id) => `'${id}'`).join(", ")}]::uuid[]`;
}

/** Un borrador con su audiencia, por la función que usa la API. */
function createCycle(
  database: TemporaryDatabase,
  clubId: string,
  options: {
    readonly name: string;
    readonly audience: Audience;
    readonly groupIds?: readonly string[];
  },
): Promise<string> {
  return database.query(
    `select public.create_training_cycle(
       '${clubId}', '${options.name}', 4, '2026-11-16', null, null, null,
       '${options.audience}', ${uuidArray(options.groupIds ?? [])})`,
  );
}

function activateSql(
  clubId: string,
  cycleId: string,
  confirm: boolean,
): string {
  return `select outcome || ':' || coalesce(affected_cycle_name, '-')
            from public.activate_training_cycle(
              '${clubId}', '${cycleId}', ${confirm})
           order by outcome, affected_cycle_name`;
}

async function activate(
  database: TemporaryDatabase,
  clubId: string,
  options: { readonly cycleId: string; readonly confirm: boolean },
): Promise<string[]> {
  return rowsOf(
    await database.query(activateSql(clubId, options.cycleId, options.confirm)),
  );
}

async function saveAudience(
  database: TemporaryDatabase,
  clubId: string,
  options: {
    readonly cycleId: string;
    readonly audience: Audience;
    readonly groupIds: readonly string[];
    readonly confirm: boolean;
  },
): Promise<string[]> {
  return rowsOf(
    await database.query(
      `select outcome || ':' || coalesce(affected_cycle_name, '-')
         from public.save_training_cycle_audience(
           '${clubId}', '${options.cycleId}', '${options.audience}',
           ${uuidArray(options.groupIds)}, ${options.confirm})
        order by outcome, affected_cycle_name`,
    ),
  );
}

function statusOf(
  database: TemporaryDatabase,
  cycleId: string,
): Promise<string> {
  return database.query(
    `select status from public.training_cycles where id = '${cycleId}'`,
  );
}

function audienceOf(
  database: TemporaryDatabase,
  cycleId: string,
): Promise<string> {
  return database.query(
    `select c.audience || '|' || coalesce(
              (select string_agg(g.name, ',' order by g.name)
                 from public.training_cycle_groups cg
                 join public.groups g on g.id = cg.group_id
                where cg.cycle_id = c.id), '-')
       from public.training_cycles c where c.id = '${cycleId}'`,
  );
}

async function seedClubWithGroups(database: TemporaryDatabase) {
  const clubId = await seededClubId(database);
  const groupA = await seedGroup(database, clubId, "Juveniles");
  const groupB = await seedGroup(database, clubId, "Masters");
  return { clubId, groupA, groupB };
}

describeConPostgres("0095 sobre los ciclos que ya había", () => {
  it("deja cada ciclo de todo el club, sin grupos, y el activo sigue activo", async () => {
    const database = await databaseBeforeMigration(MIGRATION_PREFIX);
    const clubId = await seededClubId(database);
    const active = await seedLegacyCycle(database, clubId, {
      name: "Winter",
      status: "active",
    });
    const draft = await seedLegacyCycle(database, clubId, {
      name: "Summer",
      status: "draft",
    });

    const applied = await applyRepositoryMigrations(database);

    expect(applied.code, applied.stderr).toBe(0);
    expect(await audienceOf(database, active)).toBe("club|-");
    expect(await audienceOf(database, draft)).toBe("club|-");
    expect(await statusOf(database, active)).toBe("active");
  }, REAPPLY_TIMEOUT_MS);

  it("aplicada dos veces con un activo de club y uno de grupo no falla", async () => {
    const database = await migratedDatabase();
    const { clubId, groupA } = await seedClubWithGroups(database);
    const club = await createCycle(database, clubId, {
      name: "Club",
      audience: "club",
    });
    const juniors = await createCycle(database, clubId, {
      name: "Juniors",
      audience: "groups",
      groupIds: [groupA],
    });
    await activate(database, clubId, { cycleId: club, confirm: false });
    await activate(database, clubId, { cycleId: juniors, confirm: false });

    const again = await applyRepositoryMigrations(database);

    expect(again.code, again.stderr).toBe(0);
    expect(await statusOf(database, club)).toBe("active");
    expect(await statusOf(database, juniors)).toBe("active");
    expect(await audienceOf(database, juniors)).toBe("groups|Juveniles");
  }, REAPPLY_TIMEOUT_MS);
});

describeConPostgres("la audiencia del ciclo en la base", () => {
  it("sólo admite club o groups", async () => {
    const database = await migratedDatabase();
    const clubId = await seededClubId(database);
    const cycleId = await seedLegacyCycle(database, clubId, {
      name: "Winter",
      status: "draft",
    });

    const result = await database.attempt(
      `update public.training_cycles set audience = 'team'
        where id = '${cycleId}'`,
    );

    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain("training_cycles_audience_check");
  });

  it("crea un ciclo de grupos con sus grupos, en borrador", async () => {
    const database = await migratedDatabase();
    const { clubId, groupA, groupB } = await seedClubWithGroups(database);

    const cycleId = await createCycle(database, clubId, {
      name: "Juniors",
      audience: "groups",
      groupIds: [groupA, groupB],
    });

    expect(await audienceOf(database, cycleId)).toBe(
      "groups|Juveniles,Masters",
    );
    expect(await statusOf(database, cycleId)).toBe("draft");
  });

  it("rechaza un ciclo de grupos sin grupos", async () => {
    const database = await migratedDatabase();
    const clubId = await seededClubId(database);

    const result = await database.attempt(
      `select public.create_training_cycle(
         '${clubId}', 'Juniors', 4, '2026-11-16', null, null, null,
         'groups', array[]::uuid[])`,
    );

    expect(result.code).not.toBe(0);
    const count = await database.query(
      `select count(*) from public.training_cycles where club_id = '${clubId}'`,
    );
    expect(count).toBe("0");
  });

  it("rechaza un grupo de otro club y no guarda nada", async () => {
    const database = await migratedDatabase();
    const clubId = await seededClubId(database);
    const otherClubId = await createOtherClub(database);
    const foreignGroup = await seedGroup(database, otherClubId, "Foreign");

    const result = await database.attempt(
      `select public.create_training_cycle(
         '${clubId}', 'Juniors', 4, '2026-11-16', null, null, null,
         'groups', ${uuidArray([foreignGroup])})`,
    );

    expect(result.code).not.toBe(0);
    const count = await database.query(
      `select count(*) from public.training_cycles where club_id = '${clubId}'`,
    );
    expect(count).toBe("0");
  });

  it("borrar el único grupo deja el ciclo de grupos, sin grupos y con su estado", async () => {
    const database = await migratedDatabase();
    const { clubId, groupA } = await seedClubWithGroups(database);
    const cycleId = await createCycle(database, clubId, {
      name: "Juniors",
      audience: "groups",
      groupIds: [groupA],
    });
    await activate(database, clubId, { cycleId, confirm: false });

    await database.query(`delete from public.groups where id = '${groupA}'`);

    expect(await audienceOf(database, cycleId)).toBe("groups|-");
    expect(await statusOf(database, cycleId)).toBe("active");
  });
});

describeConPostgres("activar un ciclo en la base", () => {
  it("activa dos de grupos distintos a la vez", async () => {
    const database = await migratedDatabase();
    const { clubId, groupA, groupB } = await seedClubWithGroups(database);
    const juniors = await createCycle(database, clubId, {
      name: "Juniors",
      audience: "groups",
      groupIds: [groupA],
    });
    const masters = await createCycle(database, clubId, {
      name: "Masters",
      audience: "groups",
      groupIds: [groupB],
    });

    await activate(database, clubId, { cycleId: juniors, confirm: false });
    const outcome = await activate(database, clubId, {
      cycleId: masters,
      confirm: false,
    });

    expect(outcome).toEqual(["activated:Masters"]);
    expect(await statusOf(database, juniors)).toBe("active");
    expect(await statusOf(database, masters)).toBe("active");
  });

  it("activa uno de grupo con uno de todo el club activo", async () => {
    const database = await migratedDatabase();
    const { clubId, groupA } = await seedClubWithGroups(database);
    const club = await createCycle(database, clubId, {
      name: "Club",
      audience: "club",
    });
    const juniors = await createCycle(database, clubId, {
      name: "Juniors",
      audience: "groups",
      groupIds: [groupA],
    });

    await activate(database, clubId, { cycleId: club, confirm: false });
    await activate(database, clubId, { cycleId: juniors, confirm: false });

    expect(await statusOf(database, club)).toBe("active");
    expect(await statusOf(database, juniors)).toBe("active");
  });

  it("sin confirmar, otro de todo el club devuelve el que choca y no cambia nada", async () => {
    const database = await migratedDatabase();
    const clubId = await seededClubId(database);
    const winter = await createCycle(database, clubId, {
      name: "Winter",
      audience: "club",
    });
    const summer = await createCycle(database, clubId, {
      name: "Summer",
      audience: "club",
    });
    await activate(database, clubId, { cycleId: winter, confirm: false });

    const outcome = await activate(database, clubId, {
      cycleId: summer,
      confirm: false,
    });

    expect(outcome).toEqual(["conflict:Winter"]);
    expect(await statusOf(database, winter)).toBe("active");
    expect(await statusOf(database, summer)).toBe("draft");
  });

  it("sin confirmar, uno del grupo B choca con el de los grupos A y B", async () => {
    const database = await migratedDatabase();
    const { clubId, groupA, groupB } = await seedClubWithGroups(database);
    const both = await createCycle(database, clubId, {
      name: "Both",
      audience: "groups",
      groupIds: [groupA, groupB],
    });
    const masters = await createCycle(database, clubId, {
      name: "Masters",
      audience: "groups",
      groupIds: [groupB],
    });
    await activate(database, clubId, { cycleId: both, confirm: false });

    const outcome = await activate(database, clubId, {
      cycleId: masters,
      confirm: false,
    });

    expect(outcome).toEqual(["conflict:Both"]);
    expect(await statusOf(database, masters)).toBe("draft");
  });

  it("con confirmación archiva el que choca y activa el nuevo", async () => {
    const database = await migratedDatabase();
    const { clubId, groupA, groupB } = await seedClubWithGroups(database);
    const both = await createCycle(database, clubId, {
      name: "Both",
      audience: "groups",
      groupIds: [groupA, groupB],
    });
    const masters = await createCycle(database, clubId, {
      name: "Masters",
      audience: "groups",
      groupIds: [groupB],
    });
    await activate(database, clubId, { cycleId: both, confirm: false });

    const outcome = await activate(database, clubId, {
      cycleId: masters,
      confirm: true,
    });

    expect(outcome).toEqual(["activated:Masters", "archived:Both"]);
    expect(await statusOf(database, both)).toBe("archived");
    expect(await statusOf(database, masters)).toBe("active");
  });

  it("sobre el activo no choca consigo mismo", async () => {
    const database = await migratedDatabase();
    const clubId = await seededClubId(database);
    const winter = await createCycle(database, clubId, {
      name: "Winter",
      audience: "club",
    });
    await activate(database, clubId, { cycleId: winter, confirm: false });

    const outcome = await activate(database, clubId, {
      cycleId: winter,
      confirm: false,
    });

    expect(outcome).toEqual(["activated:Winter"]);
  });

  it("no toca nada si el ciclo es de otro club", async () => {
    const database = await migratedDatabase();
    const clubId = await seededClubId(database);
    const otherClubId = await createOtherClub(database);
    const foreign = await createCycle(database, otherClubId, {
      name: "Foreign",
      audience: "club",
    });

    const outcome = await activate(database, clubId, {
      cycleId: foreign,
      confirm: true,
    });

    expect(outcome).toEqual(["missing:-"]);
    expect(await statusOf(database, foreign)).toBe("draft");
  });
});

describeConPostgres("la regla de activos sin la función", () => {
  it("rechaza un segundo activo de todo el club", async () => {
    const database = await migratedDatabase();
    const clubId = await seededClubId(database);
    await seedLegacyCycle(database, clubId, { name: "A", status: "active" });

    const result = await database.attempt(
      `insert into public.training_cycles
         (club_id, name, start_date, weeks, status)
       values ('${clubId}', 'B', '2026-11-16', 4, 'active')`,
    );

    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain("training_cycles_one_active_club_cycle");
  });

  it("rechaza activar a mano dos que comparten grupo", async () => {
    const database = await migratedDatabase();
    const { clubId, groupA, groupB } = await seedClubWithGroups(database);
    const both = await createCycle(database, clubId, {
      name: "Both",
      audience: "groups",
      groupIds: [groupA, groupB],
    });
    const masters = await createCycle(database, clubId, {
      name: "Masters",
      audience: "groups",
      groupIds: [groupB],
    });
    await database.query(
      `update public.training_cycles set status = 'active'
        where id = '${both}'`,
    );

    const result = await database.attempt(
      `update public.training_cycles set status = 'active'
        where id = '${masters}'`,
    );

    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain("training_cycle_groups_one_active");
    expect(await statusOf(database, masters)).toBe("draft");
  });

  it("rechaza añadir a mano a un activo un grupo que ya tiene otro activo", async () => {
    const database = await migratedDatabase();
    const { clubId, groupA, groupB } = await seedClubWithGroups(database);
    const juniors = await createCycle(database, clubId, {
      name: "Juniors",
      audience: "groups",
      groupIds: [groupA],
    });
    const masters = await createCycle(database, clubId, {
      name: "Masters",
      audience: "groups",
      groupIds: [groupB],
    });
    await activate(database, clubId, { cycleId: juniors, confirm: false });
    await activate(database, clubId, { cycleId: masters, confirm: false });

    const result = await database.attempt(
      `insert into public.training_cycle_groups (cycle_id, group_id, club_id)
       values ('${juniors}', '${groupB}', '${clubId}')`,
    );

    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain("training_cycle_groups_one_active");
  });

  it("con dos activaciones a la vez que chocan, queda un solo activo", async () => {
    const database = await migratedDatabase();
    const clubId = await seededClubId(database);
    const winter = await createCycle(database, clubId, {
      name: "Winter",
      audience: "club",
    });
    const summer = await createCycle(database, clubId, {
      name: "Summer",
      audience: "club",
    });

    // La espera va por fila, después de activar: la transacción sigue
    // abierta con los ciclos del club bloqueados.
    const first = database.attempt(
      `select count(*) from (
         select pg_sleep(${HOLD_SECONDS})
           from public.activate_training_cycle('${clubId}', '${winter}', true)
       ) as held`,
    );
    await delay(SECOND_ACTIVATION_DELAY_MS);
    const second = database.attempt(activateSql(clubId, summer, false));
    await Promise.all([first, second]);

    const active = await database.query(
      `select count(*) from public.training_cycles
        where club_id = '${clubId}' and status = 'active'`,
    );
    expect(active).toBe("1");
    expect(await statusOf(database, winter)).toBe("active");
    expect(await statusOf(database, summer)).toBe("draft");
  });
});

describeConPostgres("cambiar la audiencia de un ciclo", () => {
  async function seedTwoActive(database: TemporaryDatabase) {
    const seed = await seedClubWithGroups(database);
    const juniors = await createCycle(database, seed.clubId, {
      name: "Juniors",
      audience: "groups",
      groupIds: [seed.groupA],
    });
    const masters = await createCycle(database, seed.clubId, {
      name: "Masters",
      audience: "groups",
      groupIds: [seed.groupB],
    });
    await activate(database, seed.clubId, { cycleId: juniors, confirm: false });
    await activate(database, seed.clubId, { cycleId: masters, confirm: false });
    return { ...seed, juniors, masters };
  }

  it("sin confirmar, añadir un grupo con otro activo devuelve el choque y no cambia nada", async () => {
    const database = await migratedDatabase();
    const seed = await seedTwoActive(database);

    const outcome = await saveAudience(database, seed.clubId, {
      cycleId: seed.juniors,
      audience: "groups",
      groupIds: [seed.groupA, seed.groupB],
      confirm: false,
    });

    expect(outcome).toEqual(["conflict:Masters"]);
    expect(await audienceOf(database, seed.juniors)).toBe("groups|Juveniles");
    expect(await statusOf(database, seed.masters)).toBe("active");
  });

  it("con confirmación archiva el que choca y guarda los grupos", async () => {
    const database = await migratedDatabase();
    const seed = await seedTwoActive(database);

    const outcome = await saveAudience(database, seed.clubId, {
      cycleId: seed.juniors,
      audience: "groups",
      groupIds: [seed.groupA, seed.groupB],
      confirm: true,
    });

    expect(outcome).toEqual(["archived:Masters", "saved:Juniors"]);
    expect(await audienceOf(database, seed.juniors)).toBe(
      "groups|Juveniles,Masters",
    );
    expect(await statusOf(database, seed.masters)).toBe("archived");
    expect(await statusOf(database, seed.juniors)).toBe("active");
  });

  it("un borrador cambia sin chocar con nadie", async () => {
    const database = await migratedDatabase();
    const seed = await seedTwoActive(database);
    const draft = await createCycle(database, seed.clubId, {
      name: "Draft",
      audience: "club",
    });

    const outcome = await saveAudience(database, seed.clubId, {
      cycleId: draft,
      audience: "groups",
      groupIds: [seed.groupB],
      confirm: false,
    });

    expect(outcome).toEqual(["saved:Draft"]);
    expect(await audienceOf(database, draft)).toBe("groups|Masters");
  });

  it("pasar a todo el club le quita los grupos", async () => {
    const database = await migratedDatabase();
    const seed = await seedTwoActive(database);

    await saveAudience(database, seed.clubId, {
      cycleId: seed.juniors,
      audience: "club",
      groupIds: [],
      confirm: false,
    });

    expect(await audienceOf(database, seed.juniors)).toBe("club|-");
  });

  it("no toca nada si el ciclo es de otro club", async () => {
    const database = await migratedDatabase();
    const seed = await seedTwoActive(database);
    const otherClubId = await createOtherClub(database);

    const outcome = await saveAudience(database, otherClubId, {
      cycleId: seed.juniors,
      audience: "club",
      groupIds: [],
      confirm: true,
    });

    expect(outcome).toEqual(["missing:-"]);
    expect(await audienceOf(database, seed.juniors)).toBe("groups|Juveniles");
  });
});

describeConPostgres("duplicar un ciclo de grupos", () => {
  it("la copia nace en borrador con la misma audiencia y los mismos grupos", async () => {
    const database = await migratedDatabase();
    const { clubId, groupA, groupB } = await seedClubWithGroups(database);
    const both = await createCycle(database, clubId, {
      name: "Both",
      audience: "groups",
      groupIds: [groupA, groupB],
    });
    await activate(database, clubId, { cycleId: both, confirm: false });

    const copyId = await database.query(
      `select new_cycle_id from public.duplicate_training_cycle(
         '${clubId}', '${both}', 'Both (copy)', null)`,
    );

    expect(await audienceOf(database, copyId)).toBe("groups|Juveniles,Masters");
    expect(await statusOf(database, copyId)).toBe("draft");
  });
});

describeConPostgres("la tabla de los grupos de cada ciclo", () => {
  it("tiene RLS y la sesión sólo lee", async () => {
    const database = await migratedDatabase();

    const grants = await database.query(
      `select (select relrowsecurity from pg_class
                where oid = 'public.training_cycle_groups'::regclass)
           || '|' || has_table_privilege('authenticated',
                'public.training_cycle_groups', 'select')
           || '|' || has_table_privilege('authenticated',
                'public.training_cycle_groups', 'insert')
           || '|' || has_table_privilege('anon',
                'public.training_cycle_groups', 'select')`,
    );

    expect(grants).toBe("true|true|false|false");
  });

  it.each([
    "activate_training_cycle(uuid, uuid, boolean)",
    "save_training_cycle_audience(uuid, uuid, text, uuid[], boolean)",
    "create_training_cycle(uuid, text, integer, date, text, date, uuid, text, uuid[])",
  ])("sólo la llave de servicio ejecuta %s", async (signature) => {
    const database = await migratedDatabase();

    const grants = await database.query(
      `select has_function_privilege('authenticated',
                'public.${signature}', 'execute')
           || '|' || has_function_privilege('anon',
                'public.${signature}', 'execute')
           || '|' || has_function_privilege('service_role',
                'public.${signature}', 'execute')`,
    );

    expect(grants).toBe("false|false|true");
  });

  it("ya no queda la activación de dos argumentos que archivaba sin preguntar", async () => {
    const database = await migratedDatabase();

    const exists = await database.query(
      `select to_regprocedure(
         'public.activate_training_cycle(uuid, uuid)') is not null`,
    );

    expect(exists).toBe("f");
  });
});
