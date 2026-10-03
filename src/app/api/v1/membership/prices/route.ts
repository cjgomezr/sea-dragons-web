import { createApiModule, createApiRoute } from "@/lib/api/handler";
import { identifyAccountCaller } from "@/lib/auth/account-api";
import type { ClubPrices } from "@/lib/membership/stripe-prices";
import { createRouteClubPriceReader } from "@/lib/stripe/club-prices";

/**
 * Los precios del club (#486, RF-5 del PRD de E12): la cuota mensual de Full
 * y de Student y una sesión Casual, leídos de Stripe y guardados un rato en
 * la caché del servidor. Son los que enseñan las pantallas antes de cobrar,
 * así que los alcanza cualquier cuenta activa, al día o no. Un precio que no
 * se puede leer viene nulo con su motivo, y los demás llegan igual.
 */

// Depende de la sesión de quien llama y de lo que diga Stripe ahora.
export const dynamic = "force-dynamic";

export type MembershipPricesResponse = ClubPrices;

const getMembershipPrices = createApiRoute<MembershipPricesResponse>({
  handler: async ({ request, decorateResponse }) => {
    await identifyAccountCaller({ request, decorateResponse });
    return { data: await createRouteClubPriceReader().readPrices() };
  },
});

export const { GET, POST, PUT, PATCH, DELETE } = createApiModule({
  GET: getMembershipPrices,
});
