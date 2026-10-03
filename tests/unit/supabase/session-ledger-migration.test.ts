import { describe, expect, it } from "vitest";
import {
  type TemporaryDatabase,
  applyRepositoryMigrations,
  describeConPostgres,
  migratedDatabase,
} from "../../support/postgres";

/**
 * `0052_session_ledger.sql` contra un Postgres desechable (#468, RF-1 a RF-3
 * del PRD de E13, D1, D6 y D7). El saldo de un Casual es la suma de un libro:
 * el crédito de un pack entra una vez por pago, guardar la asistencia resta
 * una sesión en la misma transacción y corregirla la devuelve, el saldo nunca
 * baja de cero, y el estado de un Casual sale del saldo.
 */

const SEEDED_CLUB = "victoria-seadragons";
const STARTED_ON = "2020-01-07";

type Member = { readonly clubId: string; readonly userId: string };

type SheetRow = { readonly user_id: string; readonly status: string };

type MembershipSeed = {
  readonly plan?: string;
  readonly status?: string;
  readonly waivedUntil?: string;
};

function seededClubId(database: TemporaryDatabase): Promise<string> {
  return database.query(
    `select id from public.clubs where slug = '${SEEDED_CLUB}'`,
  );
}

async function seedMember(
  database: TemporaryDatabase,
  clubId?: string,
): Promise<Member> {
  const club = clubId ?? (await seededClubId(database));
  const userId = await database.query(
    "insert into auth.users (id) values (gen_random_uuid()) returning id",
  );
  await database.query(
    `insert into public.members
       (club_id, user_id, full_name, email, account_status)
     values ('${club}', '${userId}', 'Pablo Player',
             '${userId}@example.test', 'active')`,
  );
  return { clubId: club, userId };
}

async function seedMembership(
  database: TemporaryDatabase,
  seed: MembershipSeed = {},
): Promise<Member> {
  const member = await seedMember(database);
  const status = seed.status ?? "pending";
  const isWaived = status === "waived";
  await database.query(
    `insert into public.memberships
       (user_id, club_id, plan, status, waived_reason, waived_until)
     values ('${member.userId}', '${member.clubId}',
             '${seed.plan ?? "Casual"}', '${status}',
             ${isWaived ? "'Beca'" : "null"},
             ${seed.waivedUntil ? `'${seed.waivedUntil}'` : "null"})`,
  );
  return member;
}

function seedPayment(
  database: TemporaryDatabase,
  member: Member,
): Promise<string> {
  return database.query(
    `insert into public.payments
       (user_id, club_id, stripe_charge_id, amount_cents, status, paid_at)
     values ('${member.userId}', '${member.clubId}',
             'ch_' || gen_random_uuid(), 7500, 'paid', now())
     returning id`,
  );
}

function creditPack(
  database: TemporaryDatabase,
  request: {
    readonly member: Member;
    readonly sessions: number;
    readonly paymentId: string;
  },
): Promise<string> {
  return database.query(
    `select public.credit_session_pack(
       '${request.member.userId}', '${request.member.clubId}',
       ${request.sessions}, '${request.paymentId}')`,
  );
}

async function creditFreshPack(
  database: TemporaryDatabase,
  member: Member,
  sessions: number,
): Promise<string> {
  const paymentId = await seedPayment(database, member);
  await creditPack(database, { member, sessions, paymentId });
  return paymentId;
}

function balanceOf(
  database: TemporaryDatabase,
  member: Member,
): Promise<string> {
  return database.query(
    `select coalesce(sum(delta), 0) from public.session_ledger
      where user_id = '${member.userId}'`,
  );
}

function statusOf(
  database: TemporaryDatabase,
  member: Member,
): Promise<string> {
  return database.query(
    `select status from public.memberships
      where user_id = '${member.userId}'`,
  );
}

function seedTraining(
  database: TemporaryDatabase,
  author: Member,
): Promise<string> {
  return database.query(
    `insert into public.events
       (club_id, title, event_type, starts_on, start_time, location,
        audience, author_id)
     values ('${author.clubId}', 'Sesión', 'training', '${STARTED_ON}',
             '19:00', 'MSAC', 'all', '${author.userId}')
     returning id`,
  );
}

function saveSheet(
  database: TemporaryDatabase,
  request: {
    readonly coach: Member;
    readonly eventId: string;
    readonly rows: readonly SheetRow[];
  },
): Promise<string> {
  return database.query(
    `select public.save_attendance_sheet(
       '${request.coach.clubId}', '${request.coach.userId}',
       '${request.eventId}', '${JSON.stringify(request.rows)}'::jsonb)`,
  );
}

async function seededTraining(database: TemporaryDatabase): Promise<{
  readonly coach: Member;
  readonly eventId: string;
}> {
  const coach = await seedMember(database);
  return { coach, eventId: await seedTraining(database, coach) };
}

function changePlan(
  database: TemporaryDatabase,
  member: Member,
  plan: string,
): Promise<string> {
  return database.query(
    `update public.memberships set plan = '${plan}'
      where user_id = '${member.userId}'`,
  );
}

function columnsOf(database: TemporaryDatabase): Promise<string> {
  return database.query(
    `select string_agg(column_name || ':' || data_type, ',' order by column_name)
       from information_schema.columns
      where table_schema = 'public' and table_name = 'session_ledger'`,
  );
}

function asMember(member: Member): string {
  return `set role authenticated;
    set request.jwt.claims = '{"sub":"${member.userId}"}';`;
}

function nonEmptyLines(output: string): readonly string[] {
  return output.split("\n").filter((line) => line.trim() !== "");
}

describeConPostgres("el libro de sesiones de un Casual en la base", () => {
  describe("forma de session_ledger", () => {
    it("tiene las columnas del movimiento y ninguna más", async () => {
      const database = await migratedDatabase();

      const columnas = await columnsOf(database);

      expect(columnas).toBe(
        [
          "attendance_event_id:uuid",
          "club_id:uuid",
          "created_at:timestamp with time zone",
          "delta:integer",
          "id:uuid",
          "kind:text",
          "pack_payment_id:uuid",
          "user_id:uuid",
        ].join(","),
      );
    });

    it("rechaza un movimiento de cero sesiones", async () => {
      const database = await migratedDatabase();
      const member = await seedMembership(database);
      const paymentId = await seedPayment(database, member);

      const intento = await database.attempt(
        `insert into public.session_ledger
           (user_id, club_id, delta, kind, pack_payment_id)
         values ('${member.userId}', '${member.clubId}', 0, 'pack_purchase',
                 '${paymentId}')`,
      );

      expect(intento.code).toBeGreaterThan(0);
      expect(intento.stderr).toMatch(/session_ledger_delta_check/);
    });

    it("rechaza un tipo de movimiento fuera de pack_purchase y attendance", async () => {
      const database = await migratedDatabase();
      const member = await seedMembership(database);

      const intento = await database.attempt(
        `insert into public.session_ledger (user_id, club_id, delta, kind)
         values ('${member.userId}', '${member.clubId}', 3, 'regalo')`,
      );

      expect(intento.code).toBeGreaterThan(0);
      expect(intento.stderr).toMatch(/session_ledger_kind_check/);
    });

    it("rechaza una compra sin su pago", async () => {
      const database = await migratedDatabase();
      const member = await seedMembership(database);

      const intento = await database.attempt(
        `insert into public.session_ledger (user_id, club_id, delta, kind)
         values ('${member.userId}', '${member.clubId}', 5, 'pack_purchase')`,
      );

      expect(intento.code).toBeGreaterThan(0);
      expect(intento.stderr).toMatch(/session_ledger_reference_check/);
    });

    it("rechaza una asistencia ligada a un pago", async () => {
      const database = await migratedDatabase();
      const member = await seedMembership(database);
      const paymentId = await seedPayment(database, member);

      const intento = await database.attempt(
        `insert into public.session_ledger
           (user_id, club_id, delta, kind, pack_payment_id)
         values ('${member.userId}', '${member.clubId}', -1, 'attendance',
                 '${paymentId}')`,
      );

      expect(intento.code).toBeGreaterThan(0);
      expect(intento.stderr).toMatch(/session_ledger_reference_check/);
    });

    it("rechaza una compra con el pago de otro socio", async () => {
      const database = await migratedDatabase();
      const member = await seedMembership(database);
      const other = await seedMembership(database);
      const paymentId = await seedPayment(database, other);

      const intento = await database.attempt(
        `insert into public.session_ledger
           (user_id, club_id, delta, kind, pack_payment_id)
         values ('${member.userId}', '${member.clubId}', 5, 'pack_purchase',
                 '${paymentId}')`,
      );

      expect(intento.code).toBeGreaterThan(0);
      expect(intento.stderr).toMatch(/session_ledger_pack_payment_fkey/);
    });

    it("rechaza un movimiento de una asistencia que no existe", async () => {
      const database = await migratedDatabase();
      const member = await seedMembership(database);

      const intento = await database.attempt(
        `insert into public.session_ledger
           (user_id, club_id, delta, kind, attendance_event_id)
         values ('${member.userId}', '${member.clubId}', -1, 'attendance',
                 gen_random_uuid())`,
      );

      expect(intento.code).toBeGreaterThan(0);
      expect(intento.stderr).toMatch(/session_ledger_attendance_fkey/);
    });
  });

  it("borrar la identidad del socio se lleva sus movimientos", async () => {
    const database = await migratedDatabase();
    const member = await seedMembership(database);
    await creditFreshPack(database, member, 5);

    await database.query(
      `delete from auth.users where id = '${member.userId}'`,
    );

    await expect(
      database.query(
        `select count(*) from public.session_ledger
          where user_id = '${member.userId}'`,
      ),
    ).resolves.toBe("0");
  });

  describe("credit_session_pack", () => {
    it("suma las sesiones del pack al saldo", async () => {
      const database = await migratedDatabase();
      const member = await seedMembership(database);
      const paymentId = await seedPayment(database, member);

      const outcome = await creditPack(database, {
        member,
        sessions: 5,
        paymentId,
      });

      expect(outcome).toBe("credited");
      await expect(balanceOf(database, member)).resolves.toBe("5");
    });

    it("con el mismo pago dos veces suma una sola vez", async () => {
      const database = await migratedDatabase();
      const member = await seedMembership(database);
      const paymentId = await seedPayment(database, member);
      await creditPack(database, { member, sessions: 5, paymentId });

      const outcome = await creditPack(database, {
        member,
        sessions: 5,
        paymentId,
      });

      expect(outcome).toBe("duplicate");
      await expect(balanceOf(database, member)).resolves.toBe("5");
    });

    it("sólo service_role la ejecuta", async () => {
      const database = await migratedDatabase();

      const grantees = await database.query(
        `select string_agg(r.rolname, ',' order by r.rolname)
           from pg_roles r
          where r.rolname in ('anon', 'authenticated', 'service_role')
            and has_function_privilege(
                  r.rolname,
                  'public.credit_session_pack(uuid, uuid, integer, uuid)',
                  'execute')`,
      );

      expect(grantees).toBe("service_role");
    });
  });

  describe("el descuento al guardar la asistencia", () => {
    it.each(["present", "late"])(
      "resta una sesión a un Casual guardado como %s",
      async (status) => {
        const database = await migratedDatabase();
        const { coach, eventId } = await seededTraining(database);
        const casual = await seedMembership(database);
        await creditFreshPack(database, casual, 5);

        await saveSheet(database, {
          coach,
          eventId,
          rows: [{ user_id: casual.userId, status }],
        });

        await expect(balanceOf(database, casual)).resolves.toBe("4");
        await expect(
          database.query(
            `select kind || '|' || delta from public.session_ledger
              where attendance_event_id = '${eventId}'`,
          ),
        ).resolves.toBe("attendance|-1");
      },
    );

    it("guardar la misma hoja otra vez no resta de nuevo", async () => {
      const database = await migratedDatabase();
      const { coach, eventId } = await seededTraining(database);
      const casual = await seedMembership(database);
      await creditFreshPack(database, casual, 5);
      const rows = [{ user_id: casual.userId, status: "present" }];
      await saveSheet(database, { coach, eventId, rows });

      await saveSheet(database, {
        coach,
        eventId,
        rows: [{ user_id: casual.userId, status: "late" }],
      });

      await expect(balanceOf(database, casual)).resolves.toBe("4");
    });

    it("no resta a un Casual guardado como absent", async () => {
      const database = await migratedDatabase();
      const { coach, eventId } = await seededTraining(database);
      const casual = await seedMembership(database);
      await creditFreshPack(database, casual, 5);

      await saveSheet(database, {
        coach,
        eventId,
        rows: [{ user_id: casual.userId, status: "absent" }],
      });

      await expect(balanceOf(database, casual)).resolves.toBe("5");
    });

    it("corregirla a absent borra su movimiento y devuelve la sesión", async () => {
      const database = await migratedDatabase();
      const { coach, eventId } = await seededTraining(database);
      const casual = await seedMembership(database);
      await creditFreshPack(database, casual, 5);
      await saveSheet(database, {
        coach,
        eventId,
        rows: [{ user_id: casual.userId, status: "present" }],
      });

      await saveSheet(database, {
        coach,
        eventId,
        rows: [{ user_id: casual.userId, status: "absent" }],
      });

      await expect(balanceOf(database, casual)).resolves.toBe("5");
      await expect(
        database.query(
          `select count(*) from public.session_ledger
            where attendance_event_id = '${eventId}'`,
        ),
      ).resolves.toBe("0");
    });

    it("quitarla de la hoja borra su movimiento y devuelve la sesión", async () => {
      const database = await migratedDatabase();
      const { coach, eventId } = await seededTraining(database);
      const casual = await seedMembership(database);
      await creditFreshPack(database, casual, 5);
      await saveSheet(database, {
        coach,
        eventId,
        rows: [{ user_id: casual.userId, status: "present" }],
      });

      await saveSheet(database, { coach, eventId, rows: [] });

      await expect(balanceOf(database, casual)).resolves.toBe("5");
    });

    it("con saldo cero no inserta movimiento y el saldo sigue en cero", async () => {
      const database = await migratedDatabase();
      const { coach, eventId } = await seededTraining(database);
      const casual = await seedMembership(database);

      const outcome = await saveSheet(database, {
        coach,
        eventId,
        rows: [{ user_id: casual.userId, status: "present" }],
      });

      expect(outcome).toBe("saved");
      await expect(balanceOf(database, casual)).resolves.toBe("0");
      await expect(
        database.query("select count(*) from public.session_ledger"),
      ).resolves.toBe("0");
    });

    it.each(["Full", "Student"])(
      "no descuenta a un socio %s con saldo congelado",
      async (plan) => {
        const database = await migratedDatabase();
        const { coach, eventId } = await seededTraining(database);
        const member = await seedMembership(database);
        await creditFreshPack(database, member, 3);
        await changePlan(database, member, plan);

        await saveSheet(database, {
          coach,
          eventId,
          rows: [{ user_id: member.userId, status: "present" }],
        });

        await expect(balanceOf(database, member)).resolves.toBe("3");
      },
    );

    it("no descuenta a quien no tiene membresía", async () => {
      const database = await migratedDatabase();
      const { coach, eventId } = await seededTraining(database);
      const member = await seedMember(database);

      const outcome = await saveSheet(database, {
        coach,
        eventId,
        rows: [{ user_id: member.userId, status: "present" }],
      });

      expect(outcome).toBe("saved");
      await expect(balanceOf(database, member)).resolves.toBe("0");
    });

    it("borrar el entrenamiento devuelve la sesión", async () => {
      const database = await migratedDatabase();
      const { coach, eventId } = await seededTraining(database);
      const casual = await seedMembership(database);
      await creditFreshPack(database, casual, 1);
      await saveSheet(database, {
        coach,
        eventId,
        rows: [{ user_id: casual.userId, status: "present" }],
      });

      await database.query(`delete from public.events where id = '${eventId}'`);

      await expect(balanceOf(database, casual)).resolves.toBe("1");
      await expect(statusOf(database, casual)).resolves.toBe("active");
    });
  });

  describe("el estado de un Casual sale de su saldo", () => {
    it("pasa a active cuando el saldo sube de cero", async () => {
      const database = await migratedDatabase();
      const casual = await seedMembership(database);

      await creditFreshPack(database, casual, 5);

      await expect(statusOf(database, casual)).resolves.toBe("active");
    });

    it("vuelve a pending cuando la asistencia lo deja en cero", async () => {
      const database = await migratedDatabase();
      const { coach, eventId } = await seededTraining(database);
      const casual = await seedMembership(database);
      await creditFreshPack(database, casual, 1);

      await saveSheet(database, {
        coach,
        eventId,
        rows: [{ user_id: casual.userId, status: "present" }],
      });

      await expect(statusOf(database, casual)).resolves.toBe("pending");
    });

    it("vuelve a active cuando la corrección le devuelve la sesión", async () => {
      const database = await migratedDatabase();
      const { coach, eventId } = await seededTraining(database);
      const casual = await seedMembership(database);
      await creditFreshPack(database, casual, 1);
      await saveSheet(database, {
        coach,
        eventId,
        rows: [{ user_id: casual.userId, status: "present" }],
      });

      await saveSheet(database, {
        coach,
        eventId,
        rows: [{ user_id: casual.userId, status: "absent" }],
      });

      await expect(statusOf(database, casual)).resolves.toBe("active");
    });

    it("sigue waived con la exención vigente", async () => {
      const database = await migratedDatabase();
      const casual = await seedMembership(database, { status: "waived" });

      await creditFreshPack(database, casual, 5);

      await expect(statusOf(database, casual)).resolves.toBe("waived");
    });

    it("con la exención vencida pasa a lo que diga su saldo", async () => {
      const database = await migratedDatabase();
      const casual = await seedMembership(database, {
        status: "waived",
        waivedUntil: "2020-01-01T00:00:00Z",
      });

      await creditFreshPack(database, casual, 5);

      await expect(statusOf(database, casual)).resolves.toBe("active");
    });

    it.each(["Full", "Student"])(
      "un socio %s no cambia de estado por su saldo",
      async (plan) => {
        const database = await migratedDatabase();
        const member = await seedMembership(database, {
          plan,
          status: "past_due",
        });

        await creditFreshPack(database, member, 5);

        await expect(statusOf(database, member)).resolves.toBe("past_due");
      },
    );
  });

  describe("el saldo congelado al cambiar de plan", () => {
    it("pasar a Full conserva el saldo y no toca el estado que pone Stripe", async () => {
      const database = await migratedDatabase();
      const member = await seedMembership(database);
      await creditFreshPack(database, member, 3);

      await database.query(
        `update public.memberships set plan = 'Full', status = 'trialing'
          where user_id = '${member.userId}'`,
      );

      await expect(balanceOf(database, member)).resolves.toBe("3");
      await expect(statusOf(database, member)).resolves.toBe("trialing");
    });

    it("volver a Casual con saldo 3 congelado lo deja active sin comprar nada", async () => {
      const database = await migratedDatabase();
      const member = await seedMembership(database);
      await creditFreshPack(database, member, 3);
      await database.query(
        `update public.memberships set plan = 'Full', status = 'cancelled'
          where user_id = '${member.userId}'`,
      );

      await changePlan(database, member, "Casual");

      await expect(statusOf(database, member)).resolves.toBe("active");
      await expect(balanceOf(database, member)).resolves.toBe("3");
    });

    it("quien nunca fue Casual empieza en cero y pending", async () => {
      const database = await migratedDatabase();
      const member = await seedMembership(database, {
        plan: "Full",
        status: "active",
      });

      await changePlan(database, member, "Casual");

      await expect(statusOf(database, member)).resolves.toBe("pending");
      await expect(balanceOf(database, member)).resolves.toBe("0");
    });

    it("un cambio de plan por webhook de Stripe también recalcula el estado", async () => {
      const database = await migratedDatabase();
      const member = await seedMembership(database);
      await creditFreshPack(database, member, 2);
      await changePlan(database, member, "Full");

      await database.query(
        `select public.apply_stripe_event(
           'evt_' || gen_random_uuid(), 'customer.subscription.deleted',
           now(), '${member.userId}', '${member.clubId}',
           '{"plan":"Casual","status":"cancelled"}'::jsonb, null)`,
      );

      await expect(statusOf(database, member)).resolves.toBe("active");
    });
  });

  it("es idempotente: aplicada dos veces no falla ni cambia nada", async () => {
    const database = await migratedDatabase();
    const despuesDeLaPrimera = await database.snapshot();

    const segunda = await applyRepositoryMigrations(database);

    expect(segunda.code, segunda.stderr).toBe(0);
    expect(despuesDeLaPrimera).toMatch(/tabla session_ledger rls=t/);
    expect(await database.snapshot()).toBe(despuesDeLaPrimera);
  });

  it("schema-expected.txt declara lo que la migración deja", async () => {
    const database = await migratedDatabase();

    const comprobacion = await database.checkSchema();

    expect(comprobacion.code, comprobacion.stdout + comprobacion.stderr).toBe(
      0,
    );
  });

  describe("privilegios", () => {
    it("deja a anon sin privilegios y a authenticated sólo con la lectura", async () => {
      const database = await migratedDatabase();

      const privilegios = await database.query(
        `select grantee || ' ' || string_agg(privilege_type, ',' order by privilege_type)
           from information_schema.role_table_grants
          where table_schema = 'public' and table_name = 'session_ledger'
            and grantee in ('anon', 'authenticated')
          group by grantee order by grantee`,
      );

      expect(privilegios).toBe("authenticated SELECT");
    });

    it("da a service_role la lectura y la escritura", async () => {
      const database = await migratedDatabase();

      const privilegios = await database.query(
        `select string_agg(privilege_type, ',' order by privilege_type)
           from information_schema.role_table_grants
          where table_schema = 'public' and table_name = 'session_ledger'
            and grantee = 'service_role'
            and privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE')`,
      );

      expect(privilegios).toBe("DELETE,INSERT,SELECT,UPDATE");
    });

    it("un socio lee sólo sus movimientos y no puede escribir ninguno", async () => {
      const database = await migratedDatabase();
      const member = await seedMembership(database);
      const other = await seedMembership(database);
      await creditFreshPack(database, member, 5);
      await creditFreshPack(database, other, 10);

      const lectura = await database.query(
        `${asMember(member)} select delta from public.session_ledger`,
      );
      const escrituras = await Promise.all([
        database.attempt(
          `${asMember(member)} insert into public.session_ledger
             (user_id, club_id, delta, kind)
           values ('${member.userId}', '${member.clubId}', 9, 'pack_purchase')`,
        ),
        database.attempt(
          `${asMember(member)} update public.session_ledger set delta = 99`,
        ),
        database.attempt(
          `${asMember(member)} delete from public.session_ledger`,
        ),
      ]);

      expect(nonEmptyLines(lectura)).toEqual(["5"]);
      for (const escritura of escrituras) {
        expect(escritura.code).toBeGreaterThan(0);
        expect(escritura.stderr).toMatch(/permission denied/);
      }
    });

    it("las funciones internas no las ejecuta nadie de fuera", async () => {
      const database = await migratedDatabase();

      const grantees = await database.query(
        `select count(*)
           from pg_roles r
          where r.rolname in ('anon', 'authenticated')
            and has_function_privilege(
                  r.rolname,
                  'public.refresh_casual_membership_status(uuid, uuid)',
                  'execute')`,
      );

      expect(grantees).toBe("0");
    });
  });
});
