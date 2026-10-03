// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import {
  CLUB_PRICE_KEYS,
  PRICE_CACHE_TTL_MS,
  createClubPriceReader,
  createPriceCache,
} from "@/lib/membership/stripe-prices";
import { readStripePriceSetup } from "@/lib/stripe/stripe-client";

/**
 * Los precios del club contra la cuenta de Stripe en modo de prueba (#486).
 * Comprueba que los tres `Price` que nombran las variables existen, están en
 * AUD y son del tipo correcto: mensuales Full y Student, de pago único la
 * sesión Casual. Si alguno no lo es, el lector lo daría por no disponible y
 * Pagos diría "Precio no disponible". Sin llaves de prueba se salta con
 * aviso; con una llave real no corre nunca.
 */

const TEST_MODE_KEY_PREFIX = "sk_test_";
const NETWORK_TEST_TIMEOUT_MS = 30_000;

const isTestMode = (process.env.STRIPE_SECRET_KEY ?? "").startsWith(
  TEST_MODE_KEY_PREFIX,
);
if (!isTestMode) {
  console.warn(
    "⚠ Precios contra Stripe: test saltado, faltan las llaves de prueba de Stripe",
  );
}

describe.skipIf(!isTestMode)(
  "Precios del club en Stripe (modo de prueba)",
  () => {
    it(
      "los tres precios configurados existen, en AUD y del tipo correcto",
      async () => {
        const warn = vi.spyOn(console, "warn");
        const reader = createClubPriceReader(
          readStripePriceSetup(process.env),
          createPriceCache({
            ttlMs: PRICE_CACHE_TTL_MS,
            now: () => Date.now(),
          }),
        );

        const prices = await reader.readPrices();

        for (const key of CLUB_PRICE_KEYS) {
          expect(prices[key], `${key}: ${warn.mock.calls.join(" | ")}`).toEqual(
            {
              amountCents: expect.any(Number),
              currency: "AUD",
            },
          );
        }
      },
      NETWORK_TEST_TIMEOUT_MS,
    );
  },
);
