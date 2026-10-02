import type Stripe from "stripe";
import type { NextRequest } from "next/server";
import { createApiModule, createApiRoute } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/response";
import { createStripeWebhookGateway } from "@/lib/membership/supabase-membership-gateways";
import {
  createStripeReader,
  createStripeSetup,
} from "@/lib/stripe/stripe-client";
import {
  type StripeWebhookOutcome,
  handleStripeEvent,
} from "@/lib/stripe/stripe-webhook";
import { createServiceRoleClient } from "@/lib/supabase/service-client";

// Cada evento escribe en la base: nunca una respuesta guardada.
export const dynamic = "force-dynamic";

/** Lo que recibe Stripe. Le basta el 200; el resultado es para quien mire
 * los envíos en su panel. */
export type StripeWebhookReceipt = { readonly outcome: StripeWebhookOutcome };

const SIGNATURE_HEADER = "stripe-signature";
const NOT_CONFIGURED_REASON = "stripe_not_configured";
const NOT_CONFIGURED_MESSAGE = "Los pagos no están configurados.";
const INVALID_SIGNATURE_REASON = "invalid_signature";
const INVALID_SIGNATURE_MESSAGE =
  "La firma del webhook de Stripe no es válida.";

/** El cuerpo se lee crudo: la firma es sobre los bytes tal como llegaron, y
 * cualquier `json()` previo la rompería. */
async function verifyEvent(
  request: NextRequest,
  stripe: { readonly client: Stripe; readonly webhookSecret: string },
): Promise<Stripe.Event> {
  const signature = request.headers.get(SIGNATURE_HEADER);
  if (signature === null) {
    throw new ApiError(
      "validation_error",
      INVALID_SIGNATURE_MESSAGE,
      INVALID_SIGNATURE_REASON,
    );
  }
  const payload = await request.text();
  try {
    return await stripe.client.webhooks.constructEventAsync(
      payload,
      signature,
      stripe.webhookSecret,
    );
  } catch {
    // El SDK lanza por firma, por marca de tiempo vieja o por cuerpo que no
    // es JSON: para Stripe todos son la misma respuesta.
    throw new ApiError(
      "validation_error",
      INVALID_SIGNATURE_MESSAGE,
      INVALID_SIGNATURE_REASON,
    );
  }
}

const receiveStripeWebhook = createApiRoute<StripeWebhookReceipt>({
  handler: async ({ request }) => {
    const stripe = createStripeSetup(process.env);
    if (stripe.kind === "unconfigured") {
      // Quien llama aquí puede ser cualquiera y todavía no firmó nada: los
      // nombres de lo que falta van al registro del servidor, no a la
      // respuesta.
      console.warn(`[stripe/webhook] faltan ${stripe.missingKeys.join(", ")}`);
      throw new ApiError(
        "service_unavailable",
        NOT_CONFIGURED_MESSAGE,
        NOT_CONFIGURED_REASON,
      );
    }
    const event = await verifyEvent(request, stripe);
    const outcome = await handleStripeEvent(event, {
      gateway: createStripeWebhookGateway(createServiceRoleClient(process.env)),
      stripe: createStripeReader(stripe.client),
      prices: stripe.prices,
      now: new Date(),
      log: (line) => console.warn(line),
    });
    return { data: { outcome } };
  },
});

export const { GET, POST, PUT, PATCH, DELETE } = createApiModule({
  POST: receiveStripeWebhook,
});
