import { expect, it } from "vitest";
import {
  type TemporaryDatabase,
  describeConPostgres,
  migratedDatabase,
} from "../../support/postgres";

/**
 * `0096_training_cycle_visibility.sql` contra un Postgres desechable (#979,
 * D4 y D5 del PRD de E38): con su sesión, un socio al día lee el ciclo activo
 * de todo el club y los de sus grupos, con sus semanas, días y grupos, y nada
 * de los de otros grupos. Quien planifica lo lee todo.
 */

const SEEDED_CLUB = "victoria-seadragons";
/** Un lunes, como pide el inicio de un ciclo. */
const CYCLE_START = "2027-01-04";
/** Etiquetas que psql imprime entre las filas que sí interesan. */
const COMMAND_TAGS: ReadonlySet<string> = new Set(["SET"]);

type Role = "Coach" | "Player";
type MembershipStatus = "active" | "past_due";

type Club = {
  readonly clubId: string;
  readonly groupA: string;
  readonly groupB: string;
};

function rowsOf(output: string): string[] {
  return output
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !COMMAND_TAGS.has(line));
}

async function seedClub(database: TemporaryDatabase): Promise<Club> {
  const clubId = await database.query(
    `select id from public.clubs where slug = '${SEEDED_CLUB}'`,
  );
  const seedGroup = (name: string) =>
    database.query(
      `insert into public.groups (club_id, name)
       values ('${clubId}', '${name}') returning id`,
    );
  return {
    clubId,
    groupA: await seedGroup("Grupo A"),
    groupB: await seedGroup("Grupo B"),
  };
}

/** Un socio activo, con su membresía y en los grupos que se den. */
async function seedMember(
  database: TemporaryDatabase,
  club: Club,
  options: {
    readonly role: Role;
    readonly status: MembershipStatus;
    readonly groupIds: readonly string[];
  },
): Promise<string> {
  const userId = await database.query(
    "insert into auth.users (id) values (gen_random_uuid()) returning id",
  );
  await database.query(
    `insert into public.members
       (club_id, user_id, full_name, email, account_status, role)
     values ('${club.clubId}', '${userId}', 'Tere Training',
             '${userId}@example.test', 'active', '${options.role}');
     insert into public.memberships (user_id, club_id, plan, status)
     values ('${userId}', '${club.clubId}', 'Full', '${options.status}')`,
  );
  for (const groupId of options.groupIds) {
    await database.query(
      `insert into public.group_memberships (group_id, user_id, club_id)
       values ('${groupId}', '${userId}', '${club.clubId}')`,
    );
  }
  return userId;
}

/** Un ciclo activo con su audiencia, su semana 1 y un día de esa semana. */
async function seedActiveCycle(
  database: TemporaryDatabase,
  club: Club,
  options: { readonly name: string; readonly groupIds: readonly string[] },
): Promise<void> {
  const audience = options.groupIds.length === 0 ? "club" : "groups";
  const groups = options.groupIds.map((id) => `'${id}'`).join(", ");
  const cycleId = await database.query(
    `select public.create_training_cycle(
       '${club.clubId}', '${options.name}', 4, '${CYCLE_START}', null, null,
       null, '${audience}', array[${groups}]::uuid[])`,
  );
  const routineId = await database.query(
    `insert into public.training_routines (club_id, cycle_id, name, color_index)
     values ('${club.clubId}', '${cycleId}', 'Strength A', 0) returning id`,
  );
  await database.query(
    `update public.training_cycles set status = 'active'
      where id = '${cycleId}';
     insert into public.training_cycle_weeks (club_id, cycle_id, week_no, note)
     values ('${club.clubId}', '${cycleId}', 1, '${options.name}');
     insert into public.training_cycle_days
       (club_id, cycle_id, week_no, weekday, slot, routine_id)
     values ('${club.clubId}', '${cycleId}', 1, 0, 1, '${routineId}')`,
  );
}

/** Los tres ciclos del club: uno de todo el club, uno de A y uno de B. */
async function seedThreeCycles(
  database: TemporaryDatabase,
  club: Club,
): Promise<void> {
  await seedActiveCycle(database, club, { name: "Club", groupIds: [] });
  await seedActiveCycle(database, club, {
    name: "Solo A",
    groupIds: [club.groupA],
  });
  await seedActiveCycle(database, club, {
    name: "Solo B",
    groupIds: [club.groupB],
  });
}

/** `ciclos|semanas|días|grupos de ciclo` que lee con su sesión, cada lista
 * por el nombre de su ciclo. */
async function visibleTo(
  database: TemporaryDatabase,
  userId: string,
): Promise<string | undefined> {
  const nameList = (from: string) =>
    `(select coalesce(string_agg(x.name, ',' order by x.name), '-')
        from (${from}) x)`;
  const output = await database.query(
    `set role authenticated;
     set request.jwt.claims = '{"sub":"${userId}"}';
     select ${nameList("select name from public.training_cycles")}
       || '|' || ${nameList("select note as name from public.training_cycle_weeks")}
       || '|' || (select count(*) from public.training_cycle_days)
       || '|' || ${nameList(
         `select c.name from public.training_cycle_groups cg
            join public.training_cycles c on c.id = cg.cycle_id`,
       )}`,
  );
  return rowsOf(output).at(-1);
}

describeConPostgres("0096: qué ciclos lee cada uno con su sesión", () => {
  it("un socio al día del grupo A lee el de todo el club y el de A, no el de B", async () => {
    const database = await migratedDatabase();
    const club = await seedClub(database);
    await seedThreeCycles(database, club);
    const member = await seedMember(database, club, {
      role: "Player",
      status: "active",
      groupIds: [club.groupA],
    });

    await expect(visibleTo(database, member)).resolves.toBe(
      "Club,Solo A|Club,Solo A|2|Solo A",
    );
  });

  it("un socio al día sin grupos lee sólo el de todo el club", async () => {
    const database = await migratedDatabase();
    const club = await seedClub(database);
    await seedThreeCycles(database, club);
    const member = await seedMember(database, club, {
      role: "Player",
      status: "active",
      groupIds: [],
    });

    await expect(visibleTo(database, member)).resolves.toBe("Club|Club|1|-");
  });

  it("un socio del grupo A que no está al día no lee ninguno", async () => {
    const database = await migratedDatabase();
    const club = await seedClub(database);
    await seedThreeCycles(database, club);
    const member = await seedMember(database, club, {
      role: "Player",
      status: "past_due",
      groupIds: [club.groupA],
    });

    await expect(visibleTo(database, member)).resolves.toBe("-|-|0|-");
  });

  it("el Coach lo lee todo, aunque no esté en ningún grupo", async () => {
    const database = await migratedDatabase();
    const club = await seedClub(database);
    await seedThreeCycles(database, club);
    const coach = await seedMember(database, club, {
      role: "Coach",
      status: "past_due",
      groupIds: [],
    });

    await expect(visibleTo(database, coach)).resolves.toBe(
      "Club,Solo A,Solo B|Club,Solo A,Solo B|3|Solo A,Solo B",
    );
  });

  it("un ciclo de grupos que se quedó sin grupos no lo lee ningún socio (D9)", async () => {
    const database = await migratedDatabase();
    const club = await seedClub(database);
    await seedActiveCycle(database, club, {
      name: "Solo A",
      groupIds: [club.groupA],
    });
    const member = await seedMember(database, club, {
      role: "Player",
      status: "active",
      groupIds: [club.groupA],
    });
    await database.query(
      `delete from public.groups where id = '${club.groupA}'`,
    );

    await expect(visibleTo(database, member)).resolves.toBe("-|-|0|-");
  });
});
