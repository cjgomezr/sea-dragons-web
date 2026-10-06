// @vitest-environment node
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MEMBERSHIP_PLAN_API_PATH } from "@/lib/auth/routes";
import type { SessionState } from "@/lib/auth/session-boundary";
import type {
  MembershipPlan,
  MembershipRecord,
  ScheduledPlanChange,
} from "@/lib/membership/membership";

/**
 * `POST` y `DELETE /api/v1/membership/plan` (#456, RF-6 del PRD de E12), y
 * `PUT`, que elige el plan antes del primer pago (#479, D8). La petición
 * entra por el proxy de verdad: un Casual, que no está al día, la usa para ir
 * a Checkout, y quien está `pending` para elegir plan. Lo único doble es la
 * base y Stripe.
 */

const ORIGIN = "https://preview.seadragons.example";
const CONTINUE_HEADER = "x-middleware-next";
const USER_ID = "7b0e5a52-3c1d-4e8f-9a6b-2d4c8e1f0a37";
const CLUB_ID = "c1ab0000-0000-4000-8000-000000000001";
const SCHEDULE_ID = "sub_sched_alba";
const PERIOD_START = 1790000000;
const PERIOD_END = 1792592000;
const CHECKOUT_URL = "https://checkout.stripe.com/c/pay/cs_test_456";
const ORIGINAL_ENV = { ...process.env };

const ACTIVE_FULL: MembershipRecord = {
  userId: USER_ID,
  clubId: CLUB_ID,
  plan: "Full",
  status: "active",
  stripeCustomerId: "cus_alba",
  stripeSubscriptionId: "sub_alba",
  currentPeriodEnd: new Date(PERIOD_END * 1000),
  trialEnd: null,
  card: null,
  waiver: null,
  scheduledChange: null,
};

const SCHEDULE = {
  id: SCHEDULE_ID,
  current_phase: { start_date: PERIOD_START, end_date: PERIOD_END },
  phases: [
    {
      start_date: PERIOD_START,
      end_date: PERIOD_END,
      trial_end: null,
      items: [{ price: "price_full_test", quantity: 1 }],
    },
  ],
};

const readSessionState = vi.fn();
const findByUserId = vi.fn<() => Promise<MembershipRecord | null>>();
const saveScheduledChange =
  vi.fn<
    (userId: string, change: ScheduledPlanChange | null) => Promise<void>
  >();
const savePlanChoice =
  vi.fn<(userId: string, plan: MembershipPlan) => Promise<boolean>>();
const createSession = vi.fn();
const retrieveSubscription = vi.fn();
const updateSubscription = vi.fn();
const createSchedule = vi.fn();
const updateSchedule = vi.fn();
const releaseSchedule = vi.fn();

vi.mock("stripe", async (importOriginal) => {
  const actual = await importOriginal<typeof import("stripe")>();
  class FakeStripe {
    static errors = actual.default.errors;
    checkout = {
      sessions: { create: (...args: unknown[]) => createSession(...args) },
    };
    subscriptions = {
      retrieve: (...args: unknown[]) => retrieveSubscription(...args),
      update: (...args: unknown[]) => updateSubscription(...args),
    };
    subscriptionSchedules = {
      create: (...args: unknown[]) => createSchedule(...args),
      retrieve: async () => SCHEDULE,
      update: (...args: unknown[]) => updateSchedule(...args),
      release: (...args: unknown[]) => releaseSchedule(...args),
    };
  }
  return { default: FakeStripe };
});

vi.mock("@/lib/supabase/session-client", () => ({
  readIncomingCookies: () => [],
  applySessionCookies: () => undefined,
  createSessionClient: () => ({
    kind: "ready",
    client: {},
    recorder: { recorded: () => ({ cookies: [], headers: {} }) },
  }),
}));

vi.mock("@/lib/auth/session-reader", () => ({
  readSessionState: (...args: unknown[]) => readSessionState(...args),
  readAuthenticatedUserId: async () => USER_ID,
}));

vi.mock("@/lib/supabase/service-client", () => ({
  createServiceRoleClient: () => ({}),
}));

vi.mock("@/lib/membership/supabase-membership-gateways", () => ({
  createMembershipGateway: () => ({ findByUserId }),
  createScheduledPlanChangeGateway: () => ({ saveScheduledChange }),
  createPlanChoiceGateway: () => ({ savePlanChoice }),
  createPaymentHistoryGateway: () => ({ listByUserId: async () => [] }),
  createSessionLedgerGateway: () => ({ listByUserId: async () => [] }),
  createMemberEmailGateway: () => ({
    findEmail: async () => "alba@example.com",
  }),
}));

vi.mock("@/lib/stripe/club-prices", () => ({
  createRouteClubPriceReader: () => ({
    readPrice: async (key: "full" | "student" | "casualSession") =>
      ({
        full: { amountCents: 5150, currency: "AUD" },
        student: { amountCents: 3675, currency: "AUD" },
        casualSession: { amountCents: 1990, currency: "AUD" },
      })[key],
  }),
}));

const { default: Stripe } = await import("stripe");
const { proxy } = await import("@/proxy");
const { GET, POST, PUT, DELETE } =
  await import("@/app/api/v1/membership/plan/route");

function configureStripe(): void {
  process.env.STRIPE_SECRET_KEY = "sk_test_clave_de_prueba";
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_secreto_de_prueba";
  process.env.STRIPE_PRICE_FULL = "price_full_test";
  process.env.STRIPE_PRICE_STUDENT = "price_student_test";
}

function givenSession(session: SessionState): void {
  readSessionState.mockResolvedValue(session);
}

type PlanMethod = "POST" | "PUT" | "DELETE";

const HANDLERS = { POST, PUT, DELETE } as const;

function planRequest(method: PlanMethod, body?: unknown): NextRequest {
  return new NextRequest(new URL(MEMBERSHIP_PLAN_API_PATH, ORIGIN), {
    method,
    ...(body === undefined
      ? {}
      : {
          body: JSON.stringify(body),
          headers: { "content-type": "application/json" },
        }),
  });
}

async function send(method: PlanMethod, body?: unknown): Promise<Response> {
  const boundaryResponse = await proxy(planRequest(method, body));
  if (boundaryResponse.headers.get(CONTINUE_HEADER) !== "1") {
    return boundaryResponse;
  }
  return HANDLERS[method](planRequest(method, body));
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env = { ...ORIGINAL_ENV };
  configureStripe();
  givenSession({ kind: "active", role: "Player", membershipCurrent: true });
  findByUserId.mockResolvedValue(ACTIVE_FULL);
  saveScheduledChange.mockResolvedValue(undefined);
  savePlanChoice.mockResolvedValue(true);
  createSession.mockResolvedValue({ url: CHECKOUT_URL });
  retrieveSubscription.mockResolvedValue({ id: "sub_alba", schedule: null });
  createSchedule.mockResolvedValue(SCHEDULE);
  updateSchedule.mockResolvedValue(SCHEDULE);
  releaseSchedule.mockResolvedValue(SCHEDULE);
  updateSubscription.mockResolvedValue({
    id: "sub_alba",
    items: { data: [{ current_period_end: PERIOD_END }] },
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  process.env = { ...ORIGINAL_ENV };
});

describe("POST /api/v1/membership/plan", () => {
  it("programa el cambio para el fin del periodo y responde el plan y la fecha", async () => {
    const response = await send("POST", { plan: "Student" });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: {
        kind: "scheduled",
        plan: "Student",
        effectiveAt: new Date(PERIOD_END * 1000).toISOString(),
      },
    });
    expect(updateSchedule).toHaveBeenCalledWith(
      SCHEDULE_ID,
      expect.objectContaining({ proration_behavior: "none" }),
    );
    expect(saveScheduledChange).toHaveBeenCalledWith(USER_ID, {
      plan: "Student",
      effectiveAt: new Date(PERIOD_END * 1000),
    });
  });

  it("deja pasar a un Casual, que no está al día, y le responde Checkout", async () => {
    givenSession({ kind: "active", role: "Player", membershipCurrent: false });
    findByUserId.mockResolvedValue({
      ...ACTIVE_FULL,
      plan: "Casual",
      status: "pending",
      stripeSubscriptionId: null,
    });

    const response = await send("POST", { plan: "Full" });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: { kind: "checkout", url: CHECKOUT_URL },
    });
  });

  it("responde 401 sin sesión", async () => {
    givenSession({ kind: "anonymous" });

    const response = await send("POST", { plan: "Student" });

    expect(response.status).toBe(401);
    expect(findByUserId).not.toHaveBeenCalled();
  });

  it("responde 400 a un plan que no existe", async () => {
    const response = await send("POST", { plan: "Family" });

    expect(response.status).toBe(400);
  });

  it.each([
    [{ status: "past_due" }, "membership_not_current"],
    [
      {
        status: "waived",
        waiver: { reason: "Entrenadora", until: null, waivedBy: null },
      },
      "membership_waived",
    ],
    [{ stripeSubscriptionId: null }, "no_subscription"],
  ] as const)(
    "responde 409 con su motivo y no toca Stripe (%o)",
    async (change, reason) => {
      givenSession({
        kind: "active",
        role: "Player",
        membershipCurrent: false,
      });
      findByUserId.mockResolvedValue({ ...ACTIVE_FULL, ...change });

      const response = await send("POST", { plan: "Student" });

      expect(response.status).toBe(409);
      await expect(response.json()).resolves.toMatchObject({
        error: { code: "conflict", reason },
      });
      expect(createSchedule).not.toHaveBeenCalled();
      expect(saveScheduledChange).not.toHaveBeenCalled();
    },
  );

  it("responde 503 con su motivo cuando Stripe no contesta, y no guarda nada", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    createSchedule.mockRejectedValue(
      new Stripe.errors.StripeConnectionError({ message: "timeout" }),
    );

    const response = await send("POST", { plan: "Student" });

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "service_unavailable", reason: "stripe_unavailable" },
    });
    expect(saveScheduledChange).not.toHaveBeenCalled();
  });

  it("responde 503 cuando faltan las variables de Stripe", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    delete process.env.STRIPE_SECRET_KEY;

    const response = await send("POST", { plan: "Student" });

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: { reason: "stripe_not_configured" },
    });
  });

  it("responde 405 a un GET", async () => {
    const response = await GET(
      new NextRequest(new URL(MEMBERSHIP_PLAN_API_PATH, ORIGIN)),
    );

    expect(response.status).toBe(405);
  });
});

describe("DELETE /api/v1/membership/plan", () => {
  it("anula en Stripe el cambio programado y lo borra", async () => {
    findByUserId.mockResolvedValue({
      ...ACTIVE_FULL,
      scheduledChange: {
        plan: "Student",
        effectiveAt: new Date(PERIOD_END * 1000),
      },
    });
    retrieveSubscription.mockResolvedValue({
      id: "sub_alba",
      schedule: SCHEDULE_ID,
    });

    const response = await send("DELETE");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: { scheduledChange: null },
    });
    expect(releaseSchedule).toHaveBeenCalledWith(SCHEDULE_ID);
    expect(saveScheduledChange).toHaveBeenCalledWith(USER_ID, null);
  });

  it("responde 409 sin cambio programado", async () => {
    const response = await send("DELETE");

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: { reason: "no_scheduled_change" },
    });
  });

  it("responde 401 sin sesión", async () => {
    givenSession({ kind: "anonymous" });

    const response = await send("DELETE");

    expect(response.status).toBe(401);
  });

  it("responde 503 cuando Stripe no contesta, y el cambio sigue guardado", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    findByUserId.mockResolvedValue({
      ...ACTIVE_FULL,
      scheduledChange: { plan: "Casual", effectiveAt: new Date() },
    });
    updateSubscription.mockRejectedValue(
      new Stripe.errors.StripeConnectionError({ message: "timeout" }),
    );

    const response = await send("DELETE");

    expect(response.status).toBe(503);
    expect(saveScheduledChange).not.toHaveBeenCalled();
  });
});

describe("PUT /api/v1/membership/plan", () => {
  const PENDING_WITHOUT_PLAN: MembershipRecord = {
    ...ACTIVE_FULL,
    plan: null,
    status: "pending",
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    currentPeriodEnd: null,
  };

  beforeEach(() => {
    givenSession({ kind: "active", role: "Player", membershipCurrent: false });
  });

  it("deja pasar a quien no está al día, guarda el plan y responde la membresía actualizada", async () => {
    findByUserId
      .mockResolvedValueOnce(PENDING_WITHOUT_PLAN)
      .mockResolvedValueOnce({ ...PENDING_WITHOUT_PLAN, plan: "Student" });

    const response = await send("PUT", { plan: "Student" });

    expect(response.status).toBe(200);
    expect(savePlanChoice).toHaveBeenCalledWith(USER_ID, "Student");
    await expect(response.json()).resolves.toMatchObject({
      data: {
        paymentsConfigured: true,
        membership: {
          plan: "Student",
          status: "pending",
          monthlyPriceCents: 3675,
          canChoosePlan: true,
          casualSessionPriceCents: 1990,
        },
        payments: [],
      },
    });
  });

  it("guarda el plan aunque falten las variables de Stripe", async () => {
    delete process.env.STRIPE_SECRET_KEY;
    findByUserId.mockResolvedValue(PENDING_WITHOUT_PLAN);

    const response = await send("PUT", { plan: "Casual" });

    expect(response.status).toBe(200);
    expect(savePlanChoice).toHaveBeenCalledWith(USER_ID, "Casual");
  });

  it("responde 400 con su motivo a un plan que no existe, y no guarda nada", async () => {
    findByUserId.mockResolvedValue(PENDING_WITHOUT_PLAN);

    const response = await send("PUT", { plan: "Family" });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "validation_error", reason: "unknown_plan" },
    });
    expect(savePlanChoice).not.toHaveBeenCalled();
  });

  it("responde 401 sin sesión", async () => {
    givenSession({ kind: "anonymous" });

    const response = await send("PUT", { plan: "Full" });

    expect(response.status).toBe(401);
    expect(savePlanChoice).not.toHaveBeenCalled();
  });

  it.each([
    [
      "con suscripción en Stripe",
      { ...PENDING_WITHOUT_PLAN, stripeSubscriptionId: "sub_alba" },
    ],
    ["en prueba", { ...ACTIVE_FULL, status: "trialing" }],
    ["activo", ACTIVE_FULL],
    ["con un cobro fallido", { ...ACTIVE_FULL, status: "past_due" }],
    [
      "exento",
      {
        ...PENDING_WITHOUT_PLAN,
        status: "waived",
        waiver: { reason: "Entrenadora", until: null, waivedBy: null },
      },
    ],
  ] as const)(
    "responde 409 con su motivo a un socio %s, y no guarda nada",
    async (_who, record) => {
      findByUserId.mockResolvedValue(record);

      const response = await send("PUT", { plan: "Student" });

      expect(response.status).toBe(409);
      await expect(response.json()).resolves.toMatchObject({
        error: { code: "conflict", reason: "membership_started" },
      });
      expect(savePlanChoice).not.toHaveBeenCalled();
    },
  );

  it("responde 409 si la suscripción llegó entre la lectura y la escritura", async () => {
    findByUserId.mockResolvedValue(PENDING_WITHOUT_PLAN);
    savePlanChoice.mockResolvedValue(false);

    const response = await send("PUT", { plan: "Full" });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: { reason: "membership_started" },
    });
  });

  it("responde 409 a quien no tiene membresía", async () => {
    findByUserId.mockResolvedValue(null);

    const response = await send("PUT", { plan: "Full" });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: { reason: "no_membership" },
    });
  });
});
