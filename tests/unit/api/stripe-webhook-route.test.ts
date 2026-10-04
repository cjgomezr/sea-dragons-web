// @vitest-environment node
import { NextRequest } from "next/server";
import Stripe from "stripe";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { STRIPE_WEBHOOK_API_PATH } from "@/lib/auth/routes";
import type { StripeWebhookGateway } from "@/lib/stripe/stripe-webhook";
import type { StripeMembership } from "@/lib/stripe/webhook-events";
import {
  FIXTURE_PRICES,
  FIXTURE_USER_ID,
  stripeEvent,
} from "../../fixtures/stripe/stripe-events";

/**
 * `POST /api/v1/stripe/webhook` (#452, RF-8 y RF-9 del PRD de E12). La
 * petición entra por el proxy de verdad y la firma la verifica el SDK de
 * Stripe con un secreto de prueba: lo único doble es la base.
 */

const ORIGIN = "http://localhost:3417";
const CONTINUE_HEADER = "x-middleware-next";
const SIGNATURE_HEADER = "stripe-signature";
const WEBHOOK_SECRET = "whsec_secreto_de_prueba_del_webhook";
const CLUB_ID = "c1ab0000-0000-4000-8000-000000000001";
const ORIGINAL_ENV = { ...process.env };

const KNOWN_MEMBERSHIP: StripeMembership = {
  record: {
    userId: FIXTURE_USER_ID,
    clubId: CLUB_ID,
    plan: "Full",
    status: "pending",
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    currentPeriodEnd: null,
    trialEnd: null,
    card: null,
    waiver: null,
    scheduledChange: null,
  },
  lastStripeEventAt: null,
};

const readSessionState = vi.fn();
const findMembership = vi.fn<StripeWebhookGateway["findMembership"]>();
const applyEvent = vi.fn<StripeWebhookGateway["applyEvent"]>();
const createServiceRoleClient = vi.fn();

vi.mock("@/lib/auth/session-reader", () => ({
  readSessionState: (...args: unknown[]) => readSessionState(...args),
  readAuthenticatedUserId: vi.fn(),
}));

vi.mock("@/lib/supabase/service-client", () => ({
  createServiceRoleClient: (...args: unknown[]) =>
    createServiceRoleClient(...args),
}));

vi.mock("@/lib/membership/supabase-membership-gateways", () => ({
  createStripeWebhookGateway: () => ({ findMembership, applyEvent }),
}));

const { proxy } = await import("@/proxy");
const { GET, POST } = await import("@/app/api/v1/stripe/webhook/route");

function configureStripe(): void {
  process.env.STRIPE_SECRET_KEY = "sk_test_clave_de_prueba";
  process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;
  process.env.STRIPE_PRICE_FULL = FIXTURE_PRICES.full;
  process.env.STRIPE_PRICE_STUDENT = FIXTURE_PRICES.student;
}

function sign(payload: string, secret = WEBHOOK_SECRET): string {
  return Stripe.webhooks.generateTestHeaderString({ payload, secret });
}

function webhookRequest(
  payload: string,
  headers: Record<string, string>,
): NextRequest {
  return new NextRequest(new URL(STRIPE_WEBHOOK_API_PATH, ORIGIN), {
    method: "POST",
    body: payload,
    headers,
  });
}

async function postThroughBoundary(
  payload: string,
  headers: Record<string, string>,
): Promise<Response> {
  const boundaryResponse = await proxy(webhookRequest(payload, headers));
  return boundaryResponse.headers.get(CONTINUE_HEADER) === "1"
    ? POST(webhookRequest(payload, headers))
    : boundaryResponse;
}

function signedPost(event = stripeEvent("invoice.paid")): Promise<Response> {
  const payload = JSON.stringify(event);
  return postThroughBoundary(payload, { [SIGNATURE_HEADER]: sign(payload) });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env = { ...ORIGINAL_ENV };
  configureStripe();
  findMembership.mockResolvedValue(KNOWN_MEMBERSHIP);
  applyEvent.mockResolvedValue("applied");
});

afterEach(() => {
  vi.restoreAllMocks();
  process.env = { ...ORIGINAL_ENV };
});

describe("POST /api/v1/stripe/webhook", () => {
  it("aplica un evento bien firmado y responde 200", async () => {
    const response = await signedPost();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: { outcome: "applied" },
    });
    expect(applyEvent).toHaveBeenCalledTimes(1);
  });

  it("responde 200 sin aplicarlo otra vez a un evento repetido", async () => {
    applyEvent.mockResolvedValue("duplicate");

    const response = await signedPost();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: { outcome: "duplicate" },
    });
  });

  it("responde 400 sin firma y no escribe nada", async () => {
    const response = await postThroughBoundary(
      JSON.stringify(stripeEvent("invoice.paid")),
      {},
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "validation_error", reason: "invalid_signature" },
    });
    expect(createServiceRoleClient).not.toHaveBeenCalled();
    expect(applyEvent).not.toHaveBeenCalled();
  });

  it("responde 400 con una firma de otro secreto y no escribe nada", async () => {
    const payload = JSON.stringify(stripeEvent("invoice.paid"));

    const response = await postThroughBoundary(payload, {
      [SIGNATURE_HEADER]: sign(payload, "whsec_otro_secreto"),
    });

    expect(response.status).toBe(400);
    expect(applyEvent).not.toHaveBeenCalled();
  });

  it("responde 400 si el cuerpo cambió después de firmarlo", async () => {
    const payload = JSON.stringify(stripeEvent("invoice.paid"));
    const tampered = payload.replace("4500", "1");

    const response = await postThroughBoundary(tampered, {
      [SIGNATURE_HEADER]: sign(payload),
    });

    expect(response.status).toBe(400);
    expect(applyEvent).not.toHaveBeenCalled();
  });

  it("responde 200 e ignora un tipo de evento que no le toca", async () => {
    const response = await signedPost(
      stripeEvent("invoice.paid", { type: "customer.created" }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: { outcome: "ignored" },
    });
    expect(applyEvent).not.toHaveBeenCalled();
  });

  it.each([
    "STRIPE_SECRET_KEY",
    "STRIPE_WEBHOOK_SECRET",
    "STRIPE_PRICE_FULL",
    "STRIPE_PRICE_STUDENT",
  ])(
    "responde 503 con su motivo, sin nombrarla, cuando falta %s",
    async (name) => {
      vi.spyOn(console, "warn").mockImplementation(() => undefined);
      delete process.env[name];

      const response = await signedPost();

      expect(response.status).toBe(503);
      const rawBody = await response.text();
      expect(JSON.parse(rawBody)).toMatchObject({
        error: { code: "service_unavailable", reason: "stripe_not_configured" },
      });
      expect(rawBody).not.toContain(name);
      expect(createServiceRoleClient).not.toHaveBeenCalled();
    },
  );

  it("es pública: la frontera no pregunta por ninguna sesión", async () => {
    const response = await signedPost();

    expect(response.status).toBe(200);
    expect(readSessionState).not.toHaveBeenCalled();
  });

  it("responde 405 a un GET", async () => {
    const response = await GET(
      new NextRequest(new URL(STRIPE_WEBHOOK_API_PATH, ORIGIN)),
    );

    expect(response.status).toBe(405);
  });
});
