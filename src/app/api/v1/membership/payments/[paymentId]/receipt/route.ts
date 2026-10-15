import type { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createApiModule, createApiRoute } from "@/lib/api/handler";
import { ApiError, type ApiErrorCode } from "@/lib/api/response";
import { openAccountSession } from "@/lib/auth/account-api";
import {
  type PaymentReceiptRefusal,
  findPaymentReceipt,
} from "@/lib/membership/payment-receipt";
import { createPaymentReceiptGateway } from "@/lib/membership/supabase-membership-gateways";
import {
  asStripeBadGateway,
  resolveRoutePaymentReceiptStripe,
} from "@/lib/stripe/stripe-route";

/**
 * El recibo de Stripe de un pago cobrado (#630, RF-4 y D6 del PRD de E23):
 * la página de la factura de una cuota o el recibo del cobro de un pack o un
 * extra. El pago se lee con el cliente de la sesión, así que el de otro socio
 * no existe para quien llama, sea cual sea su rol (`payments_select_own`).
 */

// La URL del recibo caduca: se pide a Stripe en cada petición.
export const dynamic = "force-dynamic";

export type PaymentReceiptResponse = { readonly url: string };

type PaymentReceiptRouteContext = {
  readonly params: Promise<{ readonly paymentId: string }>;
};

const LOG_PREFIX = "[membership/payments/receipt]";

const STRIPE_FAILED_MESSAGE =
  "Stripe no pudo darnos el recibo. Vuelve a intentarlo en un momento.";

const REFUSALS: Record<
  PaymentReceiptRefusal,
  { readonly code: ApiErrorCode; readonly message: string }
> = {
  stripe_not_configured: {
    code: "service_unavailable",
    message: "Los pagos no están configurados.",
  },
  receipt_not_found: {
    code: "not_found",
    message: "Este pago no tiene recibo.",
  },
};

/** Un id que no es un uuid no se le manda a Postgres, que lo rechazaría. */
async function readPaymentId(
  context: PaymentReceiptRouteContext,
): Promise<string> {
  const { paymentId } = await context.params;
  if (!z.uuid().safeParse(paymentId).success) {
    throw new ApiError("validation_error", "El id del pago no es válido.");
  }
  return paymentId;
}

export function GET(
  request: NextRequest,
  context: PaymentReceiptRouteContext,
): Promise<NextResponse> {
  const route = createApiRoute<PaymentReceiptResponse>({
    handler: async ({ request: apiRequest, decorateResponse }) => {
      const session = await openAccountSession({
        request: apiRequest,
        decorateResponse,
      });
      const outcome = await findPaymentReceipt(
        {
          payments: createPaymentReceiptGateway(session.client),
          stripe: resolveRoutePaymentReceiptStripe(LOG_PREFIX),
        },
        await readPaymentId(context),
      ).catch(asStripeBadGateway(LOG_PREFIX, STRIPE_FAILED_MESSAGE));
      if (outcome.kind === "refused") {
        const refusal = REFUSALS[outcome.reason];
        throw new ApiError(refusal.code, refusal.message, outcome.reason);
      }
      return { data: { url: outcome.url } };
    },
  });
  return route(request);
}

export const { POST, PUT, PATCH, DELETE } = createApiModule({});
