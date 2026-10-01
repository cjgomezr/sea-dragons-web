import { describe, expect, it } from "vitest";
import {
  type MembershipGateway,
  type MembershipRecord,
  type MembershipStatus,
  type MembershipStanding,
  isMembershipCurrent,
  isStandingCurrent,
  readMembership,
  resolveMembership,
} from "@/lib/membership/membership";

const NOW = new Date("2026-10-01T09:00:00Z");
const YESTERDAY = new Date("2026-09-30T09:00:00Z");
const TOMORROW = new Date("2026-10-02T09:00:00Z");
const USER_ID = "8d0c4c3e-7a9f-4a52-9c0b-2f8f3d1e6a11";

function aRecord(overrides: Partial<MembershipRecord> = {}): MembershipRecord {
  return {
    userId: USER_ID,
    clubId: "c1",
    plan: "Full",
    status: "pending",
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    currentPeriodEnd: null,
    trialEnd: null,
    card: null,
    waiver: null,
    ...overrides,
  };
}

function aWaivedRecord(
  until: Date | null,
  overrides: Partial<MembershipRecord> = {},
): MembershipRecord {
  return aRecord({
    status: "waived",
    waiver: { reason: "Entrenador", until, waivedBy: null },
    ...overrides,
  });
}

function gatewayWith(record: MembershipRecord | null): MembershipGateway {
  return {
    findByUserId: async (userId) =>
      record !== null && record.userId === userId ? record : null,
  };
}

describe("isMembershipCurrent", () => {
  it.each<[MembershipStatus, boolean]>([
    ["pending", false],
    ["trialing", true],
    ["active", true],
    ["past_due", false],
    ["cancelled", false],
  ])("con estado %s responde %s", (status, expected) => {
    const membership = resolveMembership(aRecord({ status }), NOW);

    expect(isMembershipCurrent(membership)).toBe(expected);
  });

  it("da por al día una exención sin fecha de fin", () => {
    const membership = resolveMembership(aWaivedRecord(null), NOW);

    expect(isMembershipCurrent(membership)).toBe(true);
  });

  it("da por al día una exención que vence mañana", () => {
    const membership = resolveMembership(aWaivedRecord(TOMORROW), NOW);

    expect(isMembershipCurrent(membership)).toBe(true);
  });

  it("no da por al día una exención que venció ayer", () => {
    const membership = resolveMembership(aWaivedRecord(YESTERDAY), NOW);

    expect(isMembershipCurrent(membership)).toBe(false);
  });
});

describe("resolveMembership", () => {
  it("deja una exención vigente como waived, con su motivo", () => {
    const membership = resolveMembership(aWaivedRecord(TOMORROW), NOW);

    expect(membership).toMatchObject({
      status: "waived",
      waiver: { reason: "Entrenador", until: TOMORROW },
    });
  });

  it("devuelve como pending una exención vencida sin suscripción", () => {
    const membership = resolveMembership(aWaivedRecord(YESTERDAY), NOW);

    expect(membership.status).toBe("pending");
  });

  it("una exención vence justo en su fecha de fin", () => {
    const membership = resolveMembership(aWaivedRecord(NOW), NOW);

    expect(membership.status).toBe("pending");
  });

  it("devuelve como trialing una exención vencida cuya suscripción sigue en prueba", () => {
    const record = aWaivedRecord(YESTERDAY, {
      stripeSubscriptionId: "sub_1",
      trialEnd: TOMORROW,
      currentPeriodEnd: TOMORROW,
    });

    expect(resolveMembership(record, NOW).status).toBe("trialing");
  });

  it("devuelve como active una exención vencida cuya suscripción sigue en su periodo", () => {
    const record = aWaivedRecord(YESTERDAY, {
      stripeSubscriptionId: "sub_1",
      trialEnd: YESTERDAY,
      currentPeriodEnd: TOMORROW,
    });

    expect(resolveMembership(record, NOW).status).toBe("active");
  });

  it("devuelve como cancelled una exención vencida cuya suscripción ya terminó su periodo", () => {
    const record = aWaivedRecord(YESTERDAY, {
      stripeSubscriptionId: "sub_1",
      currentPeriodEnd: YESTERDAY,
    });

    expect(resolveMembership(record, NOW).status).toBe("cancelled");
  });

  it("no lleva la exención en una membresía que no es waived", () => {
    const membership = resolveMembership(aWaivedRecord(YESTERDAY), NOW);

    expect(membership).not.toHaveProperty("waiver");
  });

  it("falla si una fila waived llega sin exención", () => {
    const record = aRecord({ status: "waived", waiver: null });

    expect(() => resolveMembership(record, NOW)).toThrow(/sin exención/);
  });
});

describe("readMembership", () => {
  it("devuelve none para quien no tiene fila", async () => {
    const reading = await readMembership(gatewayWith(null), {
      userId: USER_ID,
      now: NOW,
    });

    expect(reading).toEqual({ kind: "none" });
  });

  it("devuelve la membresía de quien la tiene", async () => {
    const reading = await readMembership(
      gatewayWith(aRecord({ status: "active", plan: "Student" })),
      { userId: USER_ID, now: NOW },
    );

    expect(reading).toMatchObject({
      kind: "found",
      membership: { status: "active", plan: "Student" },
    });
  });

  it("resuelve al leer una exención vencida, sin scheduler", async () => {
    const reading = await readMembership(
      gatewayWith(aWaivedRecord(YESTERDAY)),
      { userId: USER_ID, now: NOW },
    );

    expect(reading).toMatchObject({
      kind: "found",
      membership: { status: "pending" },
    });
  });
});

function aStanding(
  overrides: Partial<MembershipStanding> = {},
): MembershipStanding {
  return {
    status: "pending",
    stripeSubscriptionId: null,
    trialEnd: null,
    currentPeriodEnd: null,
    waivedUntil: null,
    ...overrides,
  };
}

describe("si una membresía leída con el socio está al día (#453)", () => {
  it.each<[MembershipStatus, boolean]>([
    ["pending", false],
    ["trialing", true],
    ["active", true],
    ["past_due", false],
    ["cancelled", false],
    ["waived", true],
  ])("cuenta %s como al día: %s", (status, expected) => {
    expect(isStandingCurrent(aStanding({ status }), NOW)).toBe(expected);
  });

  it("no cuenta como al día a quien no tiene membresía", () => {
    expect(isStandingCurrent(null, NOW)).toBe(false);
  });

  it("deja de contar una exención vencida sin suscripción", () => {
    const standing = aStanding({ status: "waived", waivedUntil: YESTERDAY });

    expect(isStandingCurrent(standing, NOW)).toBe(false);
  });

  it("cuenta una exención vigente", () => {
    const standing = aStanding({ status: "waived", waivedUntil: TOMORROW });

    expect(isStandingCurrent(standing, NOW)).toBe(true);
  });

  it("cuenta una exención vencida cuya suscripción sigue en curso", () => {
    const standing = aStanding({
      status: "waived",
      waivedUntil: YESTERDAY,
      stripeSubscriptionId: "sub_1",
      currentPeriodEnd: TOMORROW,
    });

    expect(isStandingCurrent(standing, NOW)).toBe(true);
  });
});
