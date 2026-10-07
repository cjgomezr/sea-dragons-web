import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { FailedPaymentAlertGateway } from "./failed-payment-alert";
import { parseMembershipStanding } from "./supabase-membership-gateways";

/**
 * Lo que la cáscara lee para la alerta de pago fallido (#474). Va con el
 * cliente de la sesión: `memberships_select_own` y `payments_select_own`
 * sólo dejan leer lo propio, que es justo lo que se pide.
 */

const MEMBERSHIPS_TABLE = "memberships";
const STANDING_COLUMNS =
  "status, stripe_subscription_id, trial_end, current_period_end, waived_until";
const PAYMENTS_TABLE = "payments";
const FAILED_STATUS = "failed";

const failedInvoiceRowSchema = z.object({ created_at: z.string() });

export function createFailedPaymentAlertGateway(
  client: SupabaseClient,
): FailedPaymentAlertGateway {
  return {
    async findStanding(userId) {
      const { data, error } = await client
        .from(MEMBERSHIPS_TABLE)
        .select(STANDING_COLUMNS)
        .eq("user_id", userId)
        .maybeSingle();
      if (error) {
        throw new Error(
          `No se pudo leer la membresía de ${userId}: ${error.message}`,
        );
      }
      return parseMembershipStanding(data);
    },

    // Sólo las cuotas: un cobro de cuota llega como factura, y un pack
    // (E13) como cargo, que no deja la membresía en `past_due`. Una factura
    // es una fila (`0051`): su fecha es la del primer intento que falló.
    async findLastFailedInvoiceAt(userId) {
      const { data, error } = await client
        .from(PAYMENTS_TABLE)
        .select("created_at")
        .eq("user_id", userId)
        .eq("status", FAILED_STATUS)
        .not("stripe_invoice_id", "is", null)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) {
        throw new Error(
          `No se pudo leer el último cobro fallido de ${userId}: ${error.message}`,
        );
      }
      return data === null
        ? null
        : new Date(failedInvoiceRowSchema.parse(data).created_at);
    },
  };
}
