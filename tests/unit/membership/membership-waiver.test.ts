import { describe, expect, it } from "vitest";
import type { AuditLogInsertRow, AuditLogWriter } from "@/lib/audit/audit-log";
import { MemberToChangeNotFoundError } from "@/lib/auth/member-role-change";
import type { Role } from "@/lib/auth/roles";
import {
  type MembershipWaiverGateways,
  MembershipNotWaivedError,
  MembershipWaiverForbiddenError,
  MembershipWaiverValidationError,
  type SubscriptionCanceller,
  type WaiverRemoval,
  type WaiverScope,
  type WaiverWrite,
  type WaiverWriteInput,
  WaiverNotAuditedError,
  removeMembershipWaiver,
  waiveMembership,
} from "@/lib/membership/membership-waiver";

/**
 * La exención manual del Admin (#457, RF-4 del PRD de E12, D4), contada sin
 * Supabase ni Stripe delante. Quién puede y cómo queda la fila lo vuelve a
 * mirar `0052_membership_waiver.sql`; aquí se prueba qué se valida antes de
 * escribir, qué queda en la bitácora (NFR-010) y cuándo se cancela la
 * suscripción de Stripe.
 */

const ADMIN_ID = "a0a0a0a0-0000-4000-8000-00000000000a";
const MEMBER_ID = "b1b1b1b1-0000-4000-8000-00000000000b";
const CLUB_ID = "5c1ab000-0000-4000-8000-000000000001";
const SUBSCRIPTION_ID = "sub_123";
/** Las 10:00 del 4 de octubre en Melbourne. */
const NOW = new Date("2026-10-04T00:00:00.000Z");
const UNTIL_DAY = "2027-03-01";
const UNTIL_INSTANT = new Date("2027-03-01T00:00:00+11:00");

type FakeOptions = {
  readonly actorRole?: Role;
  readonly write?: WaiverWrite;
  readonly removal?: WaiverRemoval;
  readonly stripe?: "configured" | "unconfigured" | "failing";
  readonly auditFailure?: string;
};

type Fake = {
  readonly gateways: MembershipWaiverGateways;
  readonly writes: WaiverWriteInput[];
  readonly removals: WaiverScope[];
  readonly cancelled: string[];
  readonly logLines: string[];
  readonly auditRows: AuditLogInsertRow[];
};

type WaivedWrite = Extract<WaiverWrite, { readonly kind: "waived" }>;

function waivedWrite(overrides: Partial<WaivedWrite> = {}): WaivedWrite {
  return {
    kind: "waived",
    previousStatus: "pending",
    stripeSubscriptionId: null,
    reason: "Entrenador del club",
    until: null,
    ...overrides,
  };
}

function fakeSubscriptions(
  mode: FakeOptions["stripe"],
  cancelled: string[],
): SubscriptionCanceller {
  if (mode === "unconfigured") {
    return { kind: "unconfigured" };
  }
  return {
    kind: "configured",
    async cancelAtPeriodEnd(subscriptionId) {
      if (mode === "failing") {
        throw new Error("Stripe no responde");
      }
      cancelled.push(subscriptionId);
    },
  };
}

function fakeGateways(options: FakeOptions = {}): Fake {
  const writes: WaiverWriteInput[] = [];
  const removals: WaiverScope[] = [];
  const cancelled: string[] = [];
  const logLines: string[] = [];
  const auditRows: AuditLogInsertRow[] = [];
  const audit: AuditLogWriter = {
    async insertAuditLogRow(row) {
      if (options.auditFailure !== undefined) {
        return { error: { message: options.auditFailure } };
      }
      auditRows.push(row);
      return { error: null };
    },
  };
  return {
    gateways: {
      members: {
        findRoleRequestMember: async () => ({
          clubId: CLUB_ID,
          fullName: "Ana Admin",
          role: options.actorRole ?? "Admin",
        }),
      },
      waivers: {
        async applyWaiver(input) {
          writes.push(input);
          return options.write ?? waivedWrite();
        },
        async removeWaiver(scope) {
          removals.push(scope);
          return options.removal ?? { kind: "removed", status: "pending" };
        },
      },
      subscriptions: fakeSubscriptions(options.stripe, cancelled),
      audit,
      log: (line) => logLines.push(line),
    },
    writes,
    removals,
    cancelled,
    logLines,
    auditRows,
  };
}

function waive(
  fake: Fake,
  submission: { readonly reason?: string; readonly until?: string | null } = {},
  actorId: string = ADMIN_ID,
): ReturnType<typeof waiveMembership> {
  return waiveMembership(fake.gateways, {
    actorId,
    targetUserId: MEMBER_ID,
    submission: {
      reason: submission.reason ?? "Entrenador del club",
      until: submission.until ?? null,
    },
    now: NOW,
  });
}

describe("waiveMembership", () => {
  it("deja exento al socio y responde la exención", async () => {
    const fake = fakeGateways({
      write: waivedWrite({ until: UNTIL_INSTANT }),
    });

    const change = await waive(fake, { until: UNTIL_DAY });

    expect(change).toEqual({
      userId: MEMBER_ID,
      membershipStatus: "waived",
      waiver: {
        reason: "Entrenador del club",
        until: UNTIL_INSTANT.toISOString(),
      },
    });
    expect(fake.writes).toEqual([
      {
        targetUserId: MEMBER_ID,
        clubId: CLUB_ID,
        actorId: ADMIN_ID,
        reason: "Entrenador del club",
        until: UNTIL_DAY,
      },
    ]);
  });

  it("escribe el motivo sin los espacios de los bordes", async () => {
    const fake = fakeGateways();

    await waive(fake, { reason: "  Voluntaria  " });

    expect(fake.writes[0]?.reason).toBe("Voluntaria");
  });

  it("deja en la bitácora membership.waived con el motivo y la fecha de fin", async () => {
    const fake = fakeGateways({
      write: waivedWrite({ until: UNTIL_INSTANT }),
    });

    await waive(fake, { until: UNTIL_DAY });

    expect(fake.auditRows).toEqual([
      {
        club_id: CLUB_ID,
        actor_id: ADMIN_ID,
        action: "membership.waived",
        entity_type: "member",
        entity_id: MEMBER_ID,
        result: "success",
        metadata: {
          reason: "Entrenador del club",
          until: UNTIL_INSTANT.toISOString(),
        },
      },
    ]);
  });

  it("deja que un Admin se exima a sí mismo, y lo apunta", async () => {
    const fake = fakeGateways();

    await waiveMembership(fake.gateways, {
      actorId: ADMIN_ID,
      targetUserId: ADMIN_ID,
      submission: { reason: "Tesorera", until: null },
      now: NOW,
    });

    expect(fake.writes[0]?.targetUserId).toBe(ADMIN_ID);
    expect(fake.auditRows[0]).toMatchObject({
      actor_id: ADMIN_ID,
      entity_id: ADMIN_ID,
    });
  });

  it.each([
    ["sin motivo", { reason: "   " }, "reason_required"],
    [
      "con un motivo de 201 caracteres",
      { reason: "a".repeat(201) },
      "reason_too_long",
    ],
    [
      "con una fecha que no es un día",
      { until: "2027-02-30" },
      "until_not_a_date",
    ],
    [
      "con una fecha de otro formato",
      { until: "01/03/2027" },
      "until_not_a_date",
    ],
    [
      "con una fecha ya pasada",
      { until: "2026-09-01" },
      "until_not_after_today",
    ],
    [
      "con la fecha de hoy en Melbourne",
      { until: "2026-10-04" },
      "until_not_after_today",
    ],
  ])(
    "rechaza la exención %s sin escribir nada",
    async (_case, submission, code) => {
      const fake = fakeGateways();

      const attempt = waive(fake, submission);

      await expect(attempt).rejects.toBeInstanceOf(
        MembershipWaiverValidationError,
      );
      await expect(attempt).rejects.toMatchObject({ code });
      expect(fake.writes).toEqual([]);
      expect(fake.auditRows).toEqual([]);
    },
  );

  it("acepta un motivo de 200 caracteres", async () => {
    const fake = fakeGateways();

    await waive(fake, { reason: "a".repeat(200) });

    expect(fake.writes).toHaveLength(1);
  });

  it.each(["Coach", "Committee", "Player"] as const)(
    "no deja eximir a un %s, sin escribir",
    async (actorRole) => {
      const fake = fakeGateways({ actorRole });

      await expect(waive(fake)).rejects.toBeInstanceOf(
        MembershipWaiverForbiddenError,
      );
      expect(fake.writes).toEqual([]);
    },
  );

  it("no deja eximir si la base dice que quien actúa ya no es Admin", async () => {
    const fake = fakeGateways({ write: { kind: "actor_not_admin" } });

    await expect(waive(fake)).rejects.toBeInstanceOf(
      MembershipWaiverForbiddenError,
    );
    expect(fake.auditRows).toEqual([]);
  });

  it("dice que no existe el socio de otro club", async () => {
    const fake = fakeGateways({ write: { kind: "not_found" } });

    await expect(waive(fake)).rejects.toBeInstanceOf(
      MemberToChangeNotFoundError,
    );
  });

  it.each(["active", "trialing", "past_due"] as const)(
    "cancela al final del periodo la suscripción de un socio %s",
    async (previousStatus) => {
      const fake = fakeGateways({
        write: waivedWrite({
          previousStatus,
          stripeSubscriptionId: SUBSCRIPTION_ID,
        }),
      });

      await waive(fake);

      expect(fake.cancelled).toEqual([SUBSCRIPTION_ID]);
    },
  );

  it.each(["cancelled", "waived"] as const)(
    "no vuelve a cancelar la suscripción de un socio %s",
    async (previousStatus) => {
      const fake = fakeGateways({
        write: waivedWrite({
          previousStatus,
          stripeSubscriptionId: SUBSCRIPTION_ID,
        }),
      });

      await waive(fake);

      expect(fake.cancelled).toEqual([]);
    },
  );

  it("no llama a Stripe para quien no tiene suscripción", async () => {
    const fake = fakeGateways();

    await waive(fake);

    expect(fake.cancelled).toEqual([]);
    expect(fake.logLines).toEqual([]);
  });

  it("si Stripe falla, la exención se queda y el fallo va al log", async () => {
    const fake = fakeGateways({
      stripe: "failing",
      write: waivedWrite({
        previousStatus: "active",
        stripeSubscriptionId: SUBSCRIPTION_ID,
      }),
    });

    const change = await waive(fake);

    expect(change.membershipStatus).toBe("waived");
    expect(fake.auditRows).toHaveLength(1);
    expect(fake.logLines.join("\n")).toContain(SUBSCRIPTION_ID);
    expect(fake.logLines.join("\n")).toContain("Stripe no responde");
  });

  it("sin Stripe configurado, avisa en el log de la suscripción que queda viva", async () => {
    const fake = fakeGateways({
      stripe: "unconfigured",
      write: waivedWrite({
        previousStatus: "active",
        stripeSubscriptionId: SUBSCRIPTION_ID,
      }),
    });

    await waive(fake);

    expect(fake.logLines.join("\n")).toContain(SUBSCRIPTION_ID);
  });

  it("no finge éxito si la bitácora falla", async () => {
    const fake = fakeGateways({ auditFailure: "connection reset" });

    await expect(waive(fake)).rejects.toBeInstanceOf(WaiverNotAuditedError);
  });

  it("cancela la suscripción aunque luego falle la bitácora", async () => {
    const fake = fakeGateways({
      auditFailure: "connection reset",
      write: waivedWrite({
        previousStatus: "active",
        stripeSubscriptionId: SUBSCRIPTION_ID,
      }),
    });

    await expect(waive(fake)).rejects.toBeInstanceOf(WaiverNotAuditedError);
    expect(fake.cancelled).toEqual([SUBSCRIPTION_ID]);
  });
});

describe("removeMembershipWaiver", () => {
  function remove(fake: Fake): ReturnType<typeof removeMembershipWaiver> {
    return removeMembershipWaiver(fake.gateways, {
      actorId: ADMIN_ID,
      targetUserId: MEMBER_ID,
    });
  }

  it("devuelve la membresía al estado que le da la base, sin exención", async () => {
    const fake = fakeGateways({
      removal: { kind: "removed", status: "active" },
    });

    const change = await remove(fake);

    expect(change).toEqual({
      userId: MEMBER_ID,
      membershipStatus: "active",
      waiver: null,
    });
    expect(fake.removals).toEqual([
      { targetUserId: MEMBER_ID, clubId: CLUB_ID, actorId: ADMIN_ID },
    ]);
  });

  it("deja en la bitácora membership.waiver_removed con el estado nuevo", async () => {
    const fake = fakeGateways();

    await remove(fake);

    expect(fake.auditRows).toEqual([
      {
        club_id: CLUB_ID,
        actor_id: ADMIN_ID,
        action: "membership.waiver_removed",
        entity_type: "member",
        entity_id: MEMBER_ID,
        result: "success",
        metadata: { newStatus: "pending" },
      },
    ]);
  });

  it("dice que no hay exención que retirar, sin bitácora", async () => {
    const fake = fakeGateways({ removal: { kind: "not_waived" } });

    await expect(remove(fake)).rejects.toBeInstanceOf(MembershipNotWaivedError);
    expect(fake.auditRows).toEqual([]);
  });

  it.each(["Coach", "Committee", "Player"] as const)(
    "no deja retirar a un %s",
    async (actorRole) => {
      const fake = fakeGateways({ actorRole });

      await expect(remove(fake)).rejects.toBeInstanceOf(
        MembershipWaiverForbiddenError,
      );
      expect(fake.removals).toEqual([]);
    },
  );

  it("no deja retirar si la base dice que quien actúa ya no es Admin", async () => {
    const fake = fakeGateways({ removal: { kind: "actor_not_admin" } });

    await expect(remove(fake)).rejects.toBeInstanceOf(
      MembershipWaiverForbiddenError,
    );
  });

  it("dice que no existe el socio de otro club", async () => {
    const fake = fakeGateways({ removal: { kind: "not_found" } });

    await expect(remove(fake)).rejects.toBeInstanceOf(
      MemberToChangeNotFoundError,
    );
  });

  it("no finge éxito si la bitácora falla", async () => {
    const fake = fakeGateways({ auditFailure: "connection reset" });

    await expect(remove(fake)).rejects.toBeInstanceOf(WaiverNotAuditedError);
  });
});
