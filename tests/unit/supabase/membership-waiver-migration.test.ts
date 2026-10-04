import { expect, it } from "vitest";
import {
  type TemporaryDatabase,
  describeConPostgres,
  migratedDatabase,
} from "../../support/postgres";

/**
 * `0054_membership_waiver.sql` contra un Postgres desechable (#457, RF-4 del
 * PRD de E12). Eximir deja la membresía `waived` con motivo, fin y quién;
 * retirar la devuelve a lo que digan sus fechas; sólo un Admin activo del
 * club puede hacer ninguna de las dos, y nadie más que `service_role` las
 * llama.
 */

const SEEDED_CLUB = "victoria-seadragons";

type Seeded = {
  readonly clubId: string;
  readonly adminId: string;
  readonly playerId: string;
};

async function insertMember(
  database: TemporaryDatabase,
  member: { readonly clubId: string; readonly role: string },
): Promise<string> {
  const userId = await database.query(
    "insert into auth.users (id) values (gen_random_uuid()) returning id",
  );
  await database.query(
    `insert into public.members
       (club_id, user_id, full_name, email, account_status, role)
     values ('${member.clubId}', '${userId}', 'Socia ${member.role}',
             '${userId}@example.test', 'active', '${member.role}')`,
  );
  return userId;
}

async function seedClub(database: TemporaryDatabase): Promise<Seeded> {
  const clubId = await database.query(
    `select id from public.clubs where slug = '${SEEDED_CLUB}'`,
  );
  const adminId = await insertMember(database, { clubId, role: "Admin" });
  const playerId = await insertMember(database, { clubId, role: "Player" });
  await database.query(
    `insert into public.memberships (user_id, club_id, plan, status)
     values ('${playerId}', '${clubId}', 'Full', 'pending')`,
  );
  return { clubId, adminId, playerId };
}

function waive(
  database: TemporaryDatabase,
  seeded: Seeded,
  options: { readonly actorId?: string; readonly until?: string } = {},
): Promise<string> {
  const until = options.until === undefined ? "null" : `'${options.until}'`;
  return database.query(
    `select public.waive_membership(
       '${seeded.playerId}', '${seeded.clubId}',
       '${options.actorId ?? seeded.adminId}', '  Entrenador  ', ${until})`,
  );
}

function removeWaiver(
  database: TemporaryDatabase,
  seeded: Seeded,
  actorId: string = seeded.adminId,
): Promise<string> {
  return database.query(
    `select public.remove_membership_waiver(
       '${seeded.playerId}', '${seeded.clubId}', '${actorId}')`,
  );
}

function readMembership(
  database: TemporaryDatabase,
  seeded: Seeded,
): Promise<string> {
  return database.query(
    `select concat_ws('|', status, coalesce(waived_reason, '-'),
                      coalesce(waived_by::text, '-'),
                      coalesce(waived_until::text, '-'))
       from public.memberships where user_id = '${seeded.playerId}'`,
  );
}

describeConPostgres("la exención manual del Admin en la base", () => {
  it("deja la membresía exenta con el motivo sin espacios y quién la eximió", async () => {
    const database = await migratedDatabase();
    const seeded = await seedClub(database);

    const outcome = JSON.parse(await waive(database, seeded));

    expect(outcome).toEqual({
      outcome: "waived",
      previous_status: "pending",
      stripe_subscription_id: null,
      reason: "Entrenador",
      until: null,
    });
    await expect(readMembership(database, seeded)).resolves.toBe(
      `waived|Entrenador|${seeded.adminId}|-`,
    );
  });

  it("guarda la fecha de fin como el principio de ese día en Melbourne", async () => {
    const database = await migratedDatabase();
    const seeded = await seedClub(database);

    await waive(database, seeded, { until: "2099-07-01" });

    await expect(
      database.query(
        `select waived_until = '2099-07-01T00:00:00+10:00'::timestamptz
           from public.memberships where user_id = '${seeded.playerId}'`,
      ),
    ).resolves.toBe("t");
  });

  it("rechaza una fecha de fin que no es posterior a hoy, sin escribir", async () => {
    const database = await migratedDatabase();
    const seeded = await seedClub(database);

    await expect(
      waive(database, seeded, { until: "2020-01-01" }),
    ).rejects.toThrow(/después de hoy/);
    await expect(readMembership(database, seeded)).resolves.toBe(
      "pending|-|-|-",
    );
  });

  it("devuelve la suscripción y el estado anterior para cancelarla en Stripe", async () => {
    const database = await migratedDatabase();
    const seeded = await seedClub(database);
    await database.query(
      `update public.memberships
          set status = 'active', stripe_subscription_id = 'sub_1'
        where user_id = '${seeded.playerId}'`,
    );

    const outcome = JSON.parse(await waive(database, seeded));

    expect(outcome).toMatchObject({
      previous_status: "active",
      stripe_subscription_id: "sub_1",
    });
  });

  it("borra el cambio de plan programado, que la cancelación anula (#456)", async () => {
    const database = await migratedDatabase();
    const seeded = await seedClub(database);
    await database.query(
      `update public.memberships
          set status = 'active', stripe_subscription_id = 'sub_1',
              scheduled_plan = 'Student',
              scheduled_at = now() + interval '10 days'
        where user_id = '${seeded.playerId}'`,
    );

    await waive(database, seeded);

    await expect(
      database.query(
        `select concat_ws('|', coalesce(scheduled_plan, '-'),
                          coalesce(scheduled_at::text, '-'))
           from public.memberships where user_id = '${seeded.playerId}'`,
      ),
    ).resolves.toBe("-|-");
  });

  it("crea la membresía de quien todavía no la tiene", async () => {
    const database = await migratedDatabase();
    const seeded = await seedClub(database);
    await database.query(
      `delete from public.memberships where user_id = '${seeded.playerId}'`,
    );

    await waive(database, seeded);

    await expect(readMembership(database, seeded)).resolves.toMatch(
      /^waived\|Entrenador/,
    );
  });

  it("no deja eximir a quien no es Admin", async () => {
    const database = await migratedDatabase();
    const seeded = await seedClub(database);

    const outcome = JSON.parse(
      await waive(database, seeded, { actorId: seeded.playerId }),
    );

    expect(outcome).toEqual({ outcome: "actor_not_admin" });
    await expect(readMembership(database, seeded)).resolves.toBe(
      "pending|-|-|-",
    );
  });

  it("responde not_found al socio de otro club", async () => {
    const database = await migratedDatabase();
    const seeded = await seedClub(database);
    const otherClubId = await database.query(
      `insert into public.clubs (slug, name) values ('otro', 'Otro')
       returning id`,
    );

    const outcome = JSON.parse(
      await database.query(
        `select public.waive_membership('${seeded.playerId}',
           '${otherClubId}', '${seeded.adminId}', 'Entrenador', null)`,
      ),
    );

    expect(outcome).toEqual({ outcome: "not_found" });
  });

  it("deja que un Admin se exima a sí mismo", async () => {
    const database = await migratedDatabase();
    const seeded = await seedClub(database);

    const outcome = JSON.parse(
      await database.query(
        `select public.waive_membership('${seeded.adminId}',
           '${seeded.clubId}', '${seeded.adminId}', 'Tesorera', null)`,
      ),
    );

    expect(outcome).toMatchObject({ outcome: "waived" });
  });

  it("al retirar, quien no tiene suscripción vuelve a pending y se borra la exención", async () => {
    const database = await migratedDatabase();
    const seeded = await seedClub(database);
    await waive(database, seeded, { until: "2099-07-01" });

    const outcome = JSON.parse(await removeWaiver(database, seeded));

    expect(outcome).toEqual({ outcome: "removed", status: "pending" });
    await expect(readMembership(database, seeded)).resolves.toBe(
      "pending|-|-|-",
    );
  });

  it.each([
    ["now() + interval '5 days'", "now() + interval '30 days'", "trialing"],
    ["null", "now() + interval '10 days'", "active"],
    ["null", "now() - interval '1 day'", "cancelled"],
  ])(
    "al retirar, con suscripción vuelve a lo que digan sus fechas (prueba %s, periodo %s)",
    async (trialEnd, periodEnd, expected) => {
      const database = await migratedDatabase();
      const seeded = await seedClub(database);
      await database.query(
        `update public.memberships
            set stripe_subscription_id = 'sub_1', trial_end = ${trialEnd},
                current_period_end = ${periodEnd}
          where user_id = '${seeded.playerId}'`,
      );
      await waive(database, seeded);

      const outcome = JSON.parse(await removeWaiver(database, seeded));

      expect(outcome).toEqual({ outcome: "removed", status: expected });
    },
  );

  it("al retirar, un Casual vuelve a lo que diga su saldo de sesiones (#468)", async () => {
    const database = await migratedDatabase();
    const seeded = await seedClub(database);
    const paymentId = await database.query(
      `insert into public.payments
         (user_id, club_id, stripe_charge_id, amount_cents, status)
       values ('${seeded.playerId}', '${seeded.clubId}', 'ch_pack', 9000,
               'paid')
       returning id`,
    );
    await database.query(
      `select public.credit_session_pack('${seeded.playerId}',
         '${seeded.clubId}', 5, '${paymentId}')`,
    );
    await database.query(
      `update public.memberships set plan = 'Casual'
        where user_id = '${seeded.playerId}'`,
    );
    await waive(database, seeded);

    const outcome = JSON.parse(await removeWaiver(database, seeded));

    expect(outcome).toEqual({ outcome: "removed", status: "active" });
    await expect(readMembership(database, seeded)).resolves.toBe(
      "active|-|-|-",
    );
  });

  it("no retira nada de una membresía que no está exenta", async () => {
    const database = await migratedDatabase();
    const seeded = await seedClub(database);

    const outcome = JSON.parse(await removeWaiver(database, seeded));

    expect(outcome).toEqual({ outcome: "not_waived", status: "pending" });
  });

  it("no deja retirar a quien no es Admin", async () => {
    const database = await migratedDatabase();
    const seeded = await seedClub(database);
    await waive(database, seeded);

    const outcome = JSON.parse(
      await removeWaiver(database, seeded, seeded.playerId),
    );

    expect(outcome).toEqual({ outcome: "actor_not_admin" });
    await expect(readMembership(database, seeded)).resolves.toMatch(/^waived/);
  });

  it.each(["anon", "authenticated"])(
    "no deja ejecutar ninguna de las dos a %s",
    async (role) => {
      const database = await migratedDatabase();

      await expect(
        database.query(
          `select has_function_privilege('${role}',
             'public.waive_membership(uuid, uuid, uuid, text, date)',
             'execute')
           or has_function_privilege('${role}',
             'public.remove_membership_waiver(uuid, uuid, uuid)', 'execute')`,
        ),
      ).resolves.toBe("f");
    },
  );
});
