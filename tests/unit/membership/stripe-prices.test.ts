// @vitest-environment node
import Stripe from "stripe";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type ClubPriceIds,
  type ClubPriceReader,
  type PriceCache,
  PRICE_CACHE_TTL_MS,
  type StripePriceSnapshot,
  createClubPriceReader,
  createPriceCache,
} from "@/lib/membership/stripe-prices";

/**
 * Los precios del club salen de Stripe, nunca del código (#486, RF-5 del PRD
 * de E12). Stripe va doblado: lo que se prueba es qué se acepta de un
 * `Price`, la caché de diez minutos y qué pasa cuando no se puede leer.
 */

const START = Date.parse("2026-10-03T09:00:00Z");
const ONE_MINUTE_MS = 60_000;
const PRICE_IDS: ClubPriceIds = {
  full: "price_full",
  student: "price_student",
  casualSession: "price_casual",
};

function recurring(
  id: string,
  unitAmount: number,
  every: {
    readonly interval?: Stripe.Price.Recurring.Interval;
    readonly intervalCount?: number;
  } = {},
): StripePriceSnapshot {
  return {
    id,
    unit_amount: unitAmount,
    currency: "aud",
    type: "recurring",
    recurring: {
      interval: every.interval ?? "month",
      interval_count: every.intervalCount ?? 1,
      meter: null,
      trial_period_days: null,
      usage_type: "licensed",
    },
  };
}

function monthly(id: string, unitAmount: number): StripePriceSnapshot {
  return recurring(id, unitAmount);
}

function oneTime(id: string, unitAmount: number): StripePriceSnapshot {
  return {
    id,
    unit_amount: unitAmount,
    currency: "aud",
    type: "one_time",
    recurring: null,
  };
}

const STRIPE_PRICES: Readonly<Record<string, StripePriceSnapshot>> = {
  price_full: monthly("price_full", 5000),
  price_student: monthly("price_student", 3500),
  price_casual: oneTime("price_casual", 2000),
};

const retrieve = vi.fn<(priceId: string) => Promise<StripePriceSnapshot>>();
let clock = START;
let cache: PriceCache;

function storedPrice(priceId: string): StripePriceSnapshot {
  const price = STRIPE_PRICES[priceId];
  if (price === undefined) {
    throw new Error(`precio inesperado ${priceId}`);
  }
  return price;
}

function givenStripePrice(price: StripePriceSnapshot): void {
  retrieve.mockImplementation(async (priceId) =>
    priceId === price.id ? price : storedPrice(priceId),
  );
}

function reader(priceIds: ClubPriceIds = PRICE_IDS): ClubPriceReader {
  return createClubPriceReader({ source: { retrieve }, priceIds }, cache);
}

beforeEach(() => {
  clock = START;
  cache = createPriceCache({ ttlMs: PRICE_CACHE_TTL_MS, now: () => clock });
  retrieve.mockReset();
  retrieve.mockImplementation(async (priceId) => storedPrice(priceId));
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("los precios del club en Stripe", () => {
  it("lee de Stripe el importe y la moneda de los tres precios", async () => {
    const prices = await reader().readPrices();

    expect(prices).toEqual({
      full: { amountCents: 5000, currency: "AUD" },
      student: { amountCents: 3500, currency: "AUD" },
      casualSession: { amountCents: 2000, currency: "AUD" },
    });
    expect(retrieve).toHaveBeenCalledWith("price_full");
    expect(retrieve).toHaveBeenCalledWith("price_student");
    expect(retrieve).toHaveBeenCalledWith("price_casual");
  });

  it("lee un solo precio sin pedir los demás", async () => {
    const price = await reader().readPrice("student");

    expect(price).toEqual({ amountCents: 3500, currency: "AUD" });
    expect(retrieve).toHaveBeenCalledTimes(1);
  });
});

describe("la caché de los precios", () => {
  it("dura como mucho diez minutos", () => {
    expect(PRICE_CACHE_TTL_MS).toBeLessThanOrEqual(10 * ONE_MINUTE_MS);
  });

  it("no vuelve a llamar a Stripe dentro de la ventana", async () => {
    await reader().readPrice("full");
    clock = START + PRICE_CACHE_TTL_MS - 1;

    const price = await reader().readPrice("full");

    expect(price).toEqual({ amountCents: 5000, currency: "AUD" });
    expect(retrieve).toHaveBeenCalledTimes(1);
  });

  it("vuelve a llamar a Stripe al vencer y sirve el precio nuevo", async () => {
    await reader().readPrice("full");
    givenStripePrice(monthly("price_full", 5500));
    clock = START + PRICE_CACHE_TTL_MS;

    const price = await reader().readPrice("full");

    expect(price).toEqual({ amountCents: 5500, currency: "AUD" });
    expect(retrieve).toHaveBeenCalledTimes(2);
  });

  it("guarda cada precio por su id: cambiar la variable lee el nuevo", async () => {
    await reader().readPrice("full");
    retrieve.mockResolvedValue(monthly("price_full_v2", 6000));

    const price = await reader({
      ...PRICE_IDS,
      full: "price_full_v2",
    }).readPrice("full");

    expect(price).toEqual({ amountCents: 6000, currency: "AUD" });
    expect(retrieve).toHaveBeenLastCalledWith("price_full_v2");
  });

  it("se vacía", async () => {
    await reader().readPrice("full");

    cache.clear();
    await reader().readPrice("full");

    expect(retrieve).toHaveBeenCalledTimes(2);
  });
});

describe("un precio que no se puede leer", () => {
  it("es nulo con stripe_unavailable cuando Stripe no contesta, y lo anota", async () => {
    retrieve.mockRejectedValue(
      new Stripe.errors.StripeConnectionError({ message: "socket hang up" }),
    );

    const price = await reader().readPrice("full");

    expect(price).toEqual({ amountCents: null, reason: "stripe_unavailable" });
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining("socket hang up"),
    );
  });

  it("no guarda el fallo: la siguiente lectura vuelve a preguntar", async () => {
    retrieve.mockRejectedValueOnce(
      new Stripe.errors.StripeConnectionError({ message: "socket hang up" }),
    );
    await reader().readPrice("full");

    const price = await reader().readPrice("full");

    expect(price).toEqual({ amountCents: 5000, currency: "AUD" });
  });

  it("relanza lo que no es un fallo de Stripe", async () => {
    retrieve.mockRejectedValue(new TypeError("un bug"));

    await expect(reader().readPrice("full")).rejects.toThrow("un bug");
  });

  it("es nulo con not_configured cuando falta su variable, sin llamar a Stripe", async () => {
    const prices = await reader({
      ...PRICE_IDS,
      casualSession: null,
    }).readPrices();

    expect(prices.casualSession).toEqual({
      amountCents: null,
      reason: "not_configured",
    });
    expect(prices.full).toEqual({ amountCents: 5000, currency: "AUD" });
    expect(retrieve).not.toHaveBeenCalledWith("price_casual");
  });

  it("son todos not_configured sin la llave de Stripe", async () => {
    const prices = await createClubPriceReader(
      { source: null, priceIds: PRICE_IDS },
      cache,
    ).readPrices();

    expect(prices).toEqual({
      full: { amountCents: null, reason: "not_configured" },
      student: { amountCents: null, reason: "not_configured" },
      casualSession: { amountCents: null, reason: "not_configured" },
    });
  });
});

describe("un precio mal configurado en Stripe", () => {
  it.each<[string, StripePriceSnapshot]>([
    ["en otra moneda", { ...monthly("price_full", 5000), currency: "usd" }],
    ["anual", recurring("price_full", 5000, { interval: "year" })],
    ["cada dos meses", recurring("price_full", 5000, { intervalCount: 2 })],
    ["de pago único", oneTime("price_full", 5000)],
    ["sin importe fijo", { ...monthly("price_full", 5000), unit_amount: null }],
  ])("Full %s es misconfigured y se anota", async (_name, price) => {
    givenStripePrice(price);

    const read = await reader().readPrice("full");

    expect(read).toEqual({ amountCents: null, reason: "misconfigured" });
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining("price_full"),
    );
  });

  it("la sesión Casual recurrente es misconfigured", async () => {
    givenStripePrice(monthly("price_casual", 2000));

    const read = await reader().readPrice("casualSession");

    expect(read).toEqual({ amountCents: null, reason: "misconfigured" });
  });

  it("la sesión Casual en otra moneda es misconfigured", async () => {
    givenStripePrice({ ...oneTime("price_casual", 2000), currency: "nzd" });

    const read = await reader().readPrice("casualSession");

    expect(read).toEqual({ amountCents: null, reason: "misconfigured" });
  });
});
