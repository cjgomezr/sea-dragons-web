import { expect, it } from "vitest";
import {
  type TemporaryDatabase,
  describeConPostgres,
  migratedDatabase,
} from "../../support/postgres";

/**
 * `0052_membership_scheduled_change.sql` contra un Postgres desechable (#456,
 * RF-6 del PRD de E12). La membresía guarda el cambio de plan programado, con
 * su plan y su fecha juntos, y `apply_stripe_event` lo borra cuando el
 * webhook se lo pide.
 */

const SEEDED_CLUB = "victoria-seadragons";
const EVENT_AT = "2026-10-01T10:00:00Z";
const EFFECTIVE_AT = "2026-10-28T09:00:00Z";

type Member = { readonly clubId: string; readonly userId: string };

async function seedMemberWithScheduledChange(
  database: TemporaryDatabase,
): Promise<Member> {
  const clubId = await database.query(
    `select id from public.clubs where slug = '${SEEDED_CLUB}'`,
  );
  const userId = await database.query(
    "insert into auth.users (id) values (gen_random_uuid()) returning id",
  );
  await database.query(
    `insert into public.members
       (club_id, user_id, full_name, email, account_status)
     values ('${clubId}', '${userId}', 'Alba Full',
             '${userId}@example.test', 'active')`,
  );
  await database.query(
    `insert into public.memberships
       (user_id, club_id, plan, status, stripe_subscription_id,
        scheduled_plan, scheduled_at)
     values ('${userId}', '${clubId}', 'Full', 'active', 'sub_alba',
             'Student', '${EFFECTIVE_AT}')`,
  );
  return { clubId, userId };
}

function applyMembershipChanges(
  database: TemporaryDatabase,
  member: Member,
  input: { readonly id: string; readonly changes: Record<string, unknown> },
): Promise<string> {
  return database.query(
    `select public.apply_stripe_event(
       '${input.id}', 'customer.subscription.updated',
       '${EVENT_AT}'::timestamptz, '${member.userId}', '${member.clubId}',
       '${JSON.stringify(input.changes)}'::jsonb, null)`,
  );
}

function readMembership(
  database: TemporaryDatabase,
  member: Member,
  columns: string,
): Promise<string> {
  return database.query(
    `select concat_ws('|', ${columns}) from public.memberships
      where user_id = '${member.userId}'`,
  );
}

describeConPostgres("el cambio de plan programado en la membresía", () => {
  it("guarda el plan y la fecha del cambio", async () => {
    const database = await migratedDatabase();
    const member = await seedMemberWithScheduledChange(database);

    await expect(
      readMembership(
        database,
        member,
        "scheduled_plan, scheduled_at = timestamptz '2026-10-28T09:00:00Z'",
      ),
    ).resolves.toBe("Student|t");
  });

  it("no admite un plan programado sin fecha", async () => {
    const database = await migratedDatabase();
    const member = await seedMemberWithScheduledChange(database);

    await expect(
      database.query(
        `update public.memberships set scheduled_at = null
          where user_id = '${member.userId}'`,
      ),
    ).rejects.toThrow(/memberships_scheduled_change_check/);
  });

  it("no admite un plan programado que no existe", async () => {
    const database = await migratedDatabase();
    const member = await seedMemberWithScheduledChange(database);

    await expect(
      database.query(
        `update public.memberships set scheduled_plan = 'Family'
          where user_id = '${member.userId}'`,
      ),
    ).rejects.toThrow(/memberships_scheduled_plan_check/);
  });

  it("el webhook lo borra cuando trae las claves vacías, con el plan nuevo", async () => {
    const database = await migratedDatabase();
    const member = await seedMemberWithScheduledChange(database);

    await applyMembershipChanges(database, member, {
      id: "evt_aplicado",
      changes: { plan: "Student", scheduled_plan: null, scheduled_at: null },
    });

    await expect(
      readMembership(
        database,
        member,
        "plan, scheduled_plan is null, scheduled_at is null",
      ),
    ).resolves.toBe("Student|t|t");
  });

  it("un evento sin esas claves no lo toca", async () => {
    const database = await migratedDatabase();
    const member = await seedMemberWithScheduledChange(database);

    await applyMembershipChanges(database, member, {
      id: "evt_otro",
      changes: { status: "active" },
    });

    await expect(
      readMembership(database, member, "scheduled_plan"),
    ).resolves.toBe("Student");
  });

  it("deja la membresía como Casual pending cuando acaba la suscripción", async () => {
    const database = await migratedDatabase();
    const member = await seedMemberWithScheduledChange(database);

    await applyMembershipChanges(database, member, {
      id: "evt_fin",
      changes: {
        status: "pending",
        plan: "Casual",
        stripe_subscription_id: null,
        scheduled_plan: null,
        scheduled_at: null,
      },
    });

    await expect(
      readMembership(
        database,
        member,
        "status, plan, stripe_subscription_id is null, scheduled_plan is null",
      ),
    ).resolves.toBe("pending|Casual|t|t");
  });
});
