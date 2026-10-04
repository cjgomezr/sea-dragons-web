import Stripe from "stripe";

/**
 * Los precios del club, leídos de Stripe y nunca del código (#486; RF-5 del
 * PRD de E12, FR-062 y FR-065). Lo que se cobra lo decide el `Price` de
 * Stripe que nombra cada variable de entorno, así que lo que se enseña sale
 * del mismo sitio. Cambiar un precio es crear un `Price` nuevo y cambiar su id
 * en la variable.
 *
 * Se guardan en una caché del servidor para no llamar a Stripe en cada
 * petición. Un precio que no se puede leer es nulo con su motivo: la pantalla
 * dice que no está disponible y nunca enseña un número inventado.
 */

/** Diez minutos: un precio nuevo tarda como mucho eso en verse. */
export const PRICE_CACHE_TTL_MS = 10 * 60 * 1000;

/** El club cobra en AUD (CON-005); Stripe escribe la moneda en minúsculas. */
const CLUB_STRIPE_CURRENCY = "aud";
const CLUB_CURRENCY = "AUD";
const LOG_PREFIX = "[precios del club]";

export const CLUB_PRICE_KEYS = ["full", "student", "casualSession"] as const;
export type ClubPriceKey = (typeof CLUB_PRICE_KEYS)[number];

export type PriceUnavailableReason =
  "not_configured" | "stripe_unavailable" | "misconfigured";

export type AvailableClubPrice = {
  /** Centavos enteros (CON-005). */
  readonly amountCents: number;
  readonly currency: typeof CLUB_CURRENCY;
};

export type ClubPrice =
  | AvailableClubPrice
  | { readonly amountCents: null; readonly reason: PriceUnavailableReason };

export type ClubPrices = Readonly<Record<ClubPriceKey, ClubPrice>>;

/** El id del `Price` de cada cosa que se cobra; nulo si falta su variable. */
export type ClubPriceIds = Readonly<Record<ClubPriceKey, string | null>>;

/** Lo que se mira de un `Price` de Stripe. */
export type StripePriceSnapshot = Pick<
  Stripe.Price,
  "id" | "unit_amount" | "currency" | "type" | "recurring"
>;

export type PriceSource = {
  retrieve(priceId: string): Promise<StripePriceSnapshot>;
};

export type StripePriceSetup = {
  /** Nulo sin la llave de Stripe. */
  readonly source: PriceSource | null;
  readonly priceIds: ClubPriceIds;
};

export type PriceCache = {
  get(cacheKey: string): AvailableClubPrice | null;
  set(cacheKey: string, price: AvailableClubPrice): void;
  clear(): void;
};

export type ClubPriceReader = {
  readPrice(key: ClubPriceKey): Promise<ClubPrice>;
  readPrices(): Promise<ClubPrices>;
};

/** Full y Student son cuotas mensuales (FR-063); la sesión Casual se paga
 * una vez (FR-065). */
type Billing = "monthly" | "one_time";

const BILLING_OF: Readonly<Record<ClubPriceKey, Billing>> = {
  full: "monthly",
  student: "monthly",
  casualSession: "one_time",
};

export function createPriceCache(options: {
  readonly ttlMs: number;
  readonly now: () => number;
}): PriceCache {
  const entries = new Map<
    string,
    { readonly price: AvailableClubPrice; readonly expiresAt: number }
  >();
  return {
    get(cacheKey) {
      const entry = entries.get(cacheKey);
      if (entry === undefined || entry.expiresAt <= options.now()) {
        return null;
      }
      return entry.price;
    },
    set(cacheKey, price) {
      entries.set(cacheKey, {
        price,
        expiresAt: options.now() + options.ttlMs,
      });
    },
    clear() {
      entries.clear();
    },
  };
}

function isBilledAs(price: StripePriceSnapshot, billing: Billing): boolean {
  if (billing === "one_time") {
    return price.type === "one_time";
  }
  return (
    price.type === "recurring" &&
    price.recurring?.interval === "month" &&
    price.recurring.interval_count === 1
  );
}

function toClubPrice(
  price: StripePriceSnapshot,
  billing: Billing,
): AvailableClubPrice | null {
  if (
    price.unit_amount === null ||
    price.currency !== CLUB_STRIPE_CURRENCY ||
    !isBilledAs(price, billing)
  ) {
    return null;
  }
  return { amountCents: price.unit_amount, currency: CLUB_CURRENCY };
}

function unavailable(reason: PriceUnavailableReason): ClubPrice {
  return { amountCents: null, reason };
}

async function retrieveFromStripe(
  source: PriceSource,
  priceId: string,
): Promise<StripePriceSnapshot | null> {
  try {
    return await source.retrieve(priceId);
  } catch (error) {
    if (error instanceof Stripe.errors.StripeError) {
      console.warn(
        `${LOG_PREFIX} Stripe falló con ${priceId}: ${error.message}`,
      );
      return null;
    }
    throw error;
  }
}

async function fetchClubPrice(
  source: PriceSource,
  key: ClubPriceKey,
  priceId: string,
): Promise<ClubPrice> {
  const stripePrice = await retrieveFromStripe(source, priceId);
  if (stripePrice === null) {
    return unavailable("stripe_unavailable");
  }
  const price = toClubPrice(stripePrice, BILLING_OF[key]);
  if (price === null) {
    console.warn(
      `${LOG_PREFIX} ${priceId} (${key}) no es un precio ${BILLING_OF[key]} en AUD con importe fijo: revisa su configuración en Stripe`,
    );
    return unavailable("misconfigured");
  }
  return price;
}

export function createClubPriceReader(
  setup: StripePriceSetup,
  cache: PriceCache,
): ClubPriceReader {
  async function readPrice(key: ClubPriceKey): Promise<ClubPrice> {
    const priceId = setup.priceIds[key];
    if (setup.source === null || priceId === null) {
      return unavailable("not_configured");
    }
    const cacheKey = `${key}:${priceId}`;
    const cached = cache.get(cacheKey);
    if (cached !== null) {
      return cached;
    }
    const price = await fetchClubPrice(setup.source, key, priceId);
    if (price.amountCents !== null) {
      cache.set(cacheKey, price);
    }
    return price;
  }

  async function readPrices(): Promise<ClubPrices> {
    const [full, student, casualSession] = await Promise.all([
      readPrice("full"),
      readPrice("student"),
      readPrice("casualSession"),
    ]);
    return { full, student, casualSession };
  }

  return { readPrice, readPrices };
}
