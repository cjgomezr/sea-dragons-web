import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { LevyPaymentsGateway, PaidLevyPayment } from "./levy-sales";

/**
 * Adaptador entre el resumen de ventas de los extras (#634) y Supabase. Va
 * por la llave de servicio, como quién pagó cada levy (#531): `payments` sólo
 * deja a cada socio ver lo suyo, y esto es de todo el club. Quién lo pide ya
 * lo filtró la frontera. Sólo los extras llevan `stripe_product_id` (`0060`).
 */

const PAYMENTS_TABLE = "payments";
const PAID_STATUS = "paid";
const PAID_LEVY_COLUMNS =
  "stripe_product_id, user_id, quantity, amount_cents, description, paid_at, created_at";

const paidLevyRowSchema = z.object({
  stripe_product_id: z.string(),
  user_id: z.string(),
  quantity: z.number().int(),
  amount_cents: z.number().int(),
  description: z.string().nullable(),
  paid_at: z.string().nullable(),
  created_at: z.string(),
});

function toPaidLevyPayments(data: unknown): readonly PaidLevyPayment[] {
  return z
    .array(paidLevyRowSchema)
    .parse(data)
    .map((row) => ({
      productId: row.stripe_product_id,
      userId: row.user_id,
      quantity: row.quantity,
      amountCents: row.amount_cents,
      description: row.description,
      // El webhook guarda un extra pagado siempre con la fecha del cargo; la
      // de creación sólo cubre una fila vieja sin ella. En ISO para que se
      // ordenen comparando textos.
      paidAt: new Date(row.paid_at ?? row.created_at).toISOString(),
    }));
}

export function createLevySalesPaymentsGateway(
  client: SupabaseClient,
): LevyPaymentsGateway {
  const paidLevyPayments = (clubId: string) =>
    client
      .from(PAYMENTS_TABLE)
      .select(PAID_LEVY_COLUMNS)
      .eq("club_id", clubId)
      .eq("status", PAID_STATUS)
      .not("stripe_product_id", "is", null);
  return {
    async listClubLevyPayments(clubId) {
      const { data, error } = await paidLevyPayments(clubId);
      if (error) {
        throw new Error(
          `No se pudieron leer los extras pagados del club ${clubId}: ${error.message}`,
        );
      }
      return toPaidLevyPayments(data);
    },
    async listProductPayments({ clubId, productId }) {
      const { data, error } = await paidLevyPayments(clubId).eq(
        "stripe_product_id",
        productId,
      );
      if (error) {
        throw new Error(
          `No se pudieron leer los pagos del extra ${productId}: ${error.message}`,
        );
      }
      return toPaidLevyPayments(data);
    },
  };
}
