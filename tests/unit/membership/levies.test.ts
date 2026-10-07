// @vitest-environment node
import type Stripe from "stripe";
import { describe, expect, it, vi } from "vitest";
import type { CheckoutSessions } from "@/lib/membership/checkout";
import {
  type LevyGateways,
  listLevies,
  startLevyCheckout,
} from "@/lib/membership/levies";
import type { MembershipRecord } from "@/lib/membership/membership";

/**
 * Los levies que el comité crea en Stripe (#473, RF-6 del PRD de E13, D4 y
 * D8). Stripe va doblado: lo que se prueba es qué producto cuenta como levy,
 * cuándo sale pagado y con qué se abre Checkout.
 */

const USER_ID = "7b0e5a52-3c1d-4e8f-9a6b-2d4c8e1f0a37";
const CLUB_ID = "c1ab0000-0000-4000-8000-000000000001";
const EMAIL = "alba@example.com";
const ORIGIN = "https://seadragons.example";
const NOW = new Date("2026-10-07T09:00:00.000Z");
const CHECKOUT_URL = "https://checkout.stripe.com/c/pay/cs_test_levy";
const NATIONALS_PRODUCT = "prod_nationals";
const NATIONALS_PRICE = "price_nationals";
const NATIONALS_CENTS = 8000;

type PriceShape = Partial<
  Pick<Stripe.Price, "active" | "type" | "currency" | "unit_amount">
>;

function price(id: string, shape: PriceShape = {}): Stripe.Price {
  return {
    id,
    object: "price",
    active: true,
    type: "one_time",
    currency: "aud",
    unit_amount: NATIONALS_CENTS,
    ...shape,
  } as Stripe.Price;
}

function product(input: {
  readonly id: string;
  readonly name: string;
  readonly kind?: string;
  readonly defaultPrice?: Stripe.Price | string | null;
  readonly active?: boolean;
  readonly description?: string | null;
}): Stripe.Product {
  return {
    id: input.id,
    object: "product",
    name: input.name,
    description: input.description ?? null,
    active: input.active ?? true,
    metadata: input.kind === undefined ? {} : { seadragons_kind: input.kind },
    default_price:
      input.defaultPrice === undefined
        ? price(`price_of_${input.id}`)
        : input.defaultPrice,
  } as Stripe.Product;
}

const NATIONALS = product({
  id: NATIONALS_PRODUCT,
  name: "Nationals 2026",
  description: "Entry for the national championship",
  kind: "levy",
  defaultPrice: price(NATIONALS_PRICE),
});

function membership(): MembershipRecord {
  return {
    userId: USER_ID,
    clubId: CLUB_ID,
    plan: "Full",
    status: "past_due",
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    currentPeriodEnd: null,
    trialEnd: null,
    card: null,
    waiver: null,
    scheduledChange: null,
  };
}

function sessionsDouble(): CheckoutSessions & {
  readonly create: ReturnType<typeof vi.fn<CheckoutSessions["create"]>>;
} {
  return {
    create: vi.fn<CheckoutSessions["create"]>(async () => ({
      url: CHECKOUT_URL,
    })),
  };
}

function gateways(
  input: {
    readonly products?: readonly Stripe.Product[];
    readonly paidProductIds?: readonly string[];
    readonly sessions?: CheckoutSessions;
    readonly record?: MembershipRecord | null;
  } = {},
): LevyGateways {
  return {
    membership: {
      findByUserId: async () =>
        input.record === undefined ? membership() : input.record,
    },
    memberEmails: { findEmail: async () => EMAIL },
    paidProducts: {
      findPaidProductIds: async () => new Set(input.paidProductIds ?? []),
    },
    stripe: {
      kind: "configured",
      catalog: { listActiveProducts: async () => input.products ?? [] },
      sessions: input.sessions ?? sessionsDouble(),
    },
  };
}

function payLevy(
  target: LevyGateways,
  priceId = NATIONALS_PRICE,
): ReturnType<typeof startLevyCheckout> {
  return startLevyCheckout(target, {
    userId: USER_ID,
    origin: ORIGIN,
    now: NOW,
    priceId,
  });
}

describe("listLevies", () => {
  it("lista un producto activo marcado como levy con su precio único en AUD", async () => {
    const listing = await listLevies(gateways({ products: [NATIONALS] }), {
      userId: USER_ID,
    });

    expect(listing).toEqual({
      kind: "listed",
      levies: [
        {
          id: NATIONALS_PRICE,
          name: "Nationals 2026",
          description: "Entry for the national championship",
          amountCents: NATIONALS_CENTS,
          isPaid: false,
        },
      ],
    });
  });

  it("marca como pagado el levy cuyo producto ya pagó el socio", async () => {
    const listing = await listLevies(
      gateways({ products: [NATIONALS], paidProductIds: [NATIONALS_PRODUCT] }),
      { userId: USER_ID },
    );

    expect(listing).toMatchObject({ levies: [{ isPaid: true }] });
  });

  it.each([
    ["sin la marca", product({ id: "prod_plan", name: "Full" })],
    [
      "con la marca de otra clase de producto",
      product({ id: "prod_shirt", name: "Shirt", kind: "shop" }),
    ],
    [
      "archivado",
      product({ id: "prod_old", name: "Old", kind: "levy", active: false }),
    ],
    [
      "sin precio por defecto",
      product({
        id: "prod_none",
        name: "None",
        kind: "levy",
        defaultPrice: null,
      }),
    ],
    [
      "con el precio sin expandir",
      product({
        id: "prod_id",
        name: "Id",
        kind: "levy",
        defaultPrice: "price_x",
      }),
    ],
    [
      "con un precio recurrente",
      product({
        id: "prod_monthly",
        name: "Monthly",
        kind: "levy",
        defaultPrice: price("price_monthly", { type: "recurring" }),
      }),
    ],
    [
      "con un precio en otra moneda",
      product({
        id: "prod_usd",
        name: "USD",
        kind: "levy",
        defaultPrice: price("price_usd", { currency: "usd" }),
      }),
    ],
    [
      "con un precio archivado",
      product({
        id: "prod_archived_price",
        name: "Archived price",
        kind: "levy",
        defaultPrice: price("price_archived", { active: false }),
      }),
    ],
    [
      "con un precio sin importe fijo",
      product({
        id: "prod_custom",
        name: "Custom",
        kind: "levy",
        defaultPrice: price("price_custom", { unit_amount: null }),
      }),
    ],
  ])("no lista un producto %s", async (_case, excluded) => {
    const listing = await listLevies(
      gateways({ products: [excluded, NATIONALS] }),
      { userId: USER_ID },
    );

    expect(listing).toMatchObject({ levies: [{ id: NATIONALS_PRICE }] });
    expect(listing.kind === "listed" && listing.levies).toHaveLength(1);
  });

  it("dice que Stripe no está configurado sin leer los pagos", async () => {
    const findPaidProductIds = vi.fn();

    const listing = await listLevies(
      {
        paidProducts: { findPaidProductIds },
        stripe: { kind: "unconfigured" },
      },
      { userId: USER_ID },
    );

    expect(listing).toEqual({
      kind: "refused",
      reason: "stripe_not_configured",
    });
    expect(findPaidProductIds).not.toHaveBeenCalled();
  });
});

describe("startLevyCheckout", () => {
  it("pide un pago de una unidad del levy con el socio y el producto en los metadatos", async () => {
    const sessions = sessionsDouble();

    const outcome = await payLevy(
      gateways({ products: [NATIONALS], sessions }),
    );

    expect(outcome).toEqual({ kind: "created", url: CHECKOUT_URL });
    expect(sessions.create).toHaveBeenCalledWith(
      {
        mode: "payment",
        line_items: [{ price: NATIONALS_PRICE, quantity: 1 }],
        client_reference_id: USER_ID,
        customer_email: EMAIL,
        metadata: {
          user_id: USER_ID,
          kind: "levy",
          levy_product_id: NATIONALS_PRODUCT,
          levy_name: "Nationals 2026",
        },
        success_url: `${ORIGIN}/pagos?levy=ok`,
        cancel_url: `${ORIGIN}/pagos?levy=cancelado`,
      },
      { idempotencyKey: expect.any(String) },
    );
  });

  it("reutiliza el cliente de Stripe que ya tiene en vez de mandar el correo", async () => {
    const sessions = sessionsDouble();

    await payLevy(
      gateways({
        products: [NATIONALS],
        sessions,
        record: { ...membership(), stripeCustomerId: "cus_Alba" },
      }),
    );

    const [params] = sessions.create.mock.calls[0] ?? [];
    expect(params?.customer).toBe("cus_Alba");
    expect(params).not.toHaveProperty("customer_email");
  });

  it("manda el correo de quien no tiene membresía", async () => {
    const sessions = sessionsDouble();

    await payLevy(gateways({ products: [NATIONALS], sessions, record: null }));

    const [params] = sessions.create.mock.calls[0] ?? [];
    expect(params?.customer_email).toBe(EMAIL);
  });

  it("rechaza un precio que no es de un levy activo sin abrir Checkout", async () => {
    const sessions = sessionsDouble();

    const outcome = await payLevy(
      gateways({ products: [NATIONALS], sessions }),
      "price_full_plan",
    );

    expect(outcome).toEqual({ kind: "refused", reason: "levy_not_found" });
    expect(sessions.create).not.toHaveBeenCalled();
  });

  it("rechaza un levy que el socio ya pagó", async () => {
    const sessions = sessionsDouble();

    const outcome = await payLevy(
      gateways({
        products: [NATIONALS],
        paidProductIds: [NATIONALS_PRODUCT],
        sessions,
      }),
    );

    expect(outcome).toEqual({ kind: "refused", reason: "levy_already_paid" });
    expect(sessions.create).not.toHaveBeenCalled();
  });

  it("dice que Stripe no está configurado", async () => {
    const outcome = await payLevy({
      ...gateways(),
      stripe: { kind: "unconfigured" },
    });

    expect(outcome).toEqual({
      kind: "refused",
      reason: "stripe_not_configured",
    });
  });

  it("lanza si Stripe devuelve una sesión sin dirección", async () => {
    const sessions = sessionsDouble();
    sessions.create.mockResolvedValue({ url: null });

    await expect(
      payLevy(gateways({ products: [NATIONALS], sessions })),
    ).rejects.toThrow(/dirección/);
  });
});
