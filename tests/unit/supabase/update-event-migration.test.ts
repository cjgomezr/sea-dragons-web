import { expect, it } from "vitest";
import {
  type TemporaryDatabase,
  describeConPostgres,
  migratedDatabase,
} from "../../support/postgres";

/**
 * `0040_update_event.sql` contra un Postgres desechable (#314, RF-11 del PRD
 * de E7). La función escribe sólo lo que traen los cambios, sustituye la
 * audiencia entera o no escribe nada, y no toca un evento cancelado o que ya
 * empezó.
 */

const SEEDED_CLUB = "victoria-seadragons";

type World = {
  readonly clubId: string;
  readonly userId: string;
  readonly eventId: string;
  readonly seniorSquad: string;
  readonly mastersSquad: string;
};

function seedGroup(
  database: TemporaryDatabase,
  clubId: string,
  name: string,
): Promise<string> {
  return database.query(
    `insert into public.groups (club_id, name) values ('${clubId}', '${name}')
     returning id`,
  );
}

/** Un evento futuro para el Senior Squad, con una respuesta. */
async function seedWorld(
  database: TemporaryDatabase,
  startsOn = "2099-07-10",
): Promise<World> {
  const clubId = await database.query(
    `select id from public.clubs where slug = '${SEEDED_CLUB}'`,
  );
  const userId = await database.query(
    "insert into auth.users (id) values (gen_random_uuid()) returning id",
  );
  await database.query(
    `insert into public.members
       (club_id, user_id, full_name, email, account_status)
     values ('${clubId}', '${userId}', 'Carla Committee',
             '${userId}@example.test', 'active')`,
  );
  const seniorSquad = await seedGroup(database, clubId, "Senior Squad");
  const mastersSquad = await seedGroup(database, clubId, "Masters");
  const eventId = await database.query(
    `insert into public.events
       (club_id, title, event_type, starts_on, start_time, location, notes,
        audience, author_id)
     values ('${clubId}', 'Liga estatal', 'competition', '${startsOn}',
             '10:00', 'MSAC', 'Llevad gorro azul.', 'groups', '${userId}')
     returning id`,
  );
  await database.query(
    `insert into public.event_groups (event_id, group_id, club_id)
     values ('${eventId}', '${seniorSquad}', '${clubId}')`,
  );
  await database.query(
    `insert into public.event_rsvps (event_id, user_id, club_id, response)
     values ('${eventId}', '${userId}', '${clubId}', 'yes')`,
  );
  return { clubId, userId, eventId, seniorSquad, mastersSquad };
}

function updateEventCall(world: World, changes: object): string {
  return `select public.update_event('${world.clubId}', '${world.eventId}', '${JSON.stringify(changes)}'::jsonb)`;
}

function describeEvent(
  database: TemporaryDatabase,
  world: World,
): Promise<string> {
  return database.query(
    `select title || '|' || starts_on || '|' || start_time || '|'
            || location || '|' || coalesce(notes, 'sin notas') || '|'
            || audience
       from public.events where id = '${world.eventId}'`,
  );
}

function audienceGroups(
  database: TemporaryDatabase,
  world: World,
): Promise<string> {
  return database.query(
    `select coalesce(string_agg(group_id::text, ',' order by group_id), '')
       from public.event_groups where event_id = '${world.eventId}'`,
  );
}

describeConPostgres("editar un evento en la base", () => {
  it("cambia sólo el lugar y conserva lo demás, la audiencia y las respuestas", async () => {
    const database = await migratedDatabase();
    const world = await seedWorld(database);

    const saved = await database.query(
      updateEventCall(world, { location: "Aquatic Centre" }),
    );

    expect(saved).toBe("t");
    await expect(describeEvent(database, world)).resolves.toBe(
      "Liga estatal|2099-07-10|10:00:00|Aquatic Centre|Llevad gorro azul.|groups",
    );
    await expect(audienceGroups(database, world)).resolves.toBe(
      world.seniorSquad,
    );
    await expect(
      database.query(
        `select count(*) from public.event_rsvps
          where event_id = '${world.eventId}'`,
      ),
    ).resolves.toBe("1");
  });

  it("vacía las notas cuando llegan a null", async () => {
    const database = await migratedDatabase();
    const world = await seedWorld(database);

    await database.query(updateEventCall(world, { notes: null }));

    await expect(describeEvent(database, world)).resolves.toBe(
      "Liga estatal|2099-07-10|10:00:00|MSAC|sin notas|groups",
    );
  });

  it("sustituye la audiencia entera por la nueva", async () => {
    const database = await migratedDatabase();
    const world = await seedWorld(database);

    await database.query(
      updateEventCall(world, {
        audience: "groups",
        group_ids: [world.mastersSquad],
      }),
    );

    await expect(audienceGroups(database, world)).resolves.toBe(
      world.mastersSquad,
    );
  });

  it("pasa a todo el club sin filas de audiencia", async () => {
    const database = await migratedDatabase();
    const world = await seedWorld(database);

    await database.query(
      updateEventCall(world, { audience: "all", group_ids: [] }),
    );

    await expect(audienceGroups(database, world)).resolves.toBe("");
  });

  it("no escribe nada si un grupo nuevo no es del club", async () => {
    const database = await migratedDatabase();
    const world = await seedWorld(database);
    const otherClub = await database.query(
      `insert into public.clubs (name, slug)
       values ('Otro club', 'otro-club-' || gen_random_uuid())
       returning id`,
    );
    const foreignGroup = await seedGroup(database, otherClub, "Ajeno");

    const attempt = await database.attempt(
      updateEventCall(world, {
        title: "Cambiado",
        audience: "groups",
        group_ids: [world.mastersSquad, foreignGroup],
      }),
    );

    expect(attempt.code).not.toBe(0);
    await expect(describeEvent(database, world)).resolves.toBe(
      "Liga estatal|2099-07-10|10:00:00|MSAC|Llevad gorro azul.|groups",
    );
    await expect(audienceGroups(database, world)).resolves.toBe(
      world.seniorSquad,
    );
  });

  it("deja lo del último cuando se guarda dos veces", async () => {
    const database = await migratedDatabase();
    const world = await seedWorld(database);

    await database.query(updateEventCall(world, { location: "Primera" }));
    await database.query(updateEventCall(world, { location: "Segunda" }));

    await expect(
      database.query(
        `select location from public.events where id = '${world.eventId}'`,
      ),
    ).resolves.toBe("Segunda");
  });

  it("no toca un evento cancelado", async () => {
    const database = await migratedDatabase();
    const world = await seedWorld(database);
    await database.query(
      `update public.events set status = 'cancelled', cancelled_at = now()
        where id = '${world.eventId}'`,
    );

    const saved = await database.query(
      updateEventCall(world, { location: "Aquatic Centre" }),
    );

    expect(saved).toBe("f");
    await expect(
      database.query(
        `select location from public.events where id = '${world.eventId}'`,
      ),
    ).resolves.toBe("MSAC");
  });

  it("no toca un evento que ya empezó", async () => {
    const database = await migratedDatabase();
    const world = await seedWorld(database, "2020-01-01");

    const saved = await database.query(
      updateEventCall(world, { location: "Aquatic Centre" }),
    );

    expect(saved).toBe("f");
  });

  it("no toca un evento de otro club", async () => {
    const database = await migratedDatabase();
    const world = await seedWorld(database);
    const otherClub = await database.query(
      `insert into public.clubs (name, slug)
       values ('Otro club', 'otro-club-' || gen_random_uuid())
       returning id`,
    );

    const saved = await database.query(
      updateEventCall(
        { ...world, clubId: otherClub },
        { location: "Aquatic Centre" },
      ),
    );

    expect(saved).toBe("f");
  });
});

describeConPostgres("quién puede editar eventos en la base", () => {
  it("sólo service_role ejecuta update_event", async () => {
    const database = await migratedDatabase();

    const grantees = await database.query(
      `select string_agg(r.rolname, ',' order by r.rolname)
         from pg_roles r
        where r.rolname in ('anon', 'authenticated', 'service_role')
          and has_function_privilege(
                r.rolname, 'public.update_event(uuid, uuid, jsonb)', 'execute')`,
    );

    expect(grantees).toBe("service_role");
  });
});
