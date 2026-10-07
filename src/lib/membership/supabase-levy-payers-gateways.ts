import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { ACCOUNT_STATUSES } from "@/lib/auth/account-status";
import type { LevyPayersGateways } from "./levy-payers";
import { PAYMENT_STATUSES } from "./membership-view";

/**
 * Adaptador entre quién pagó cada levy (#531) y Supabase. Va por la llave de
 * servicio, como el resto de Pagos: `payments` sólo deja a cada socio ver lo
 * suyo, y esta lista es de todo el club. Quién la pide ya lo filtró la
 * frontera.
 */

const MEMBERS_TABLE = "members";
const PAYMENTS_TABLE = "payments";

const clubIdRowSchema = z.object({ club_id: z.string() });

const clubMemberRowSchema = z.object({
  user_id: z.string(),
  full_name: z.string(),
  email: z.string(),
  account_status: z.enum(ACCOUNT_STATUSES),
});

const levyPaymentRowSchema = z.object({
  user_id: z.string(),
  amount_cents: z.number().int(),
  status: z.enum(PAYMENT_STATUSES),
  paid_at: z.string().nullable(),
  created_at: z.string(),
});

export function createClubMembersGateway(
  client: SupabaseClient,
): LevyPayersGateways["clubMembers"] {
  return {
    async findMemberClubId(userId) {
      const { data, error } = await client
        .from(MEMBERS_TABLE)
        .select("club_id")
        .eq("user_id", userId)
        .maybeSingle();
      if (error) {
        throw new Error(
          `No se pudo buscar el club del socio ${userId}: ${error.message}`,
        );
      }
      return data === null ? null : clubIdRowSchema.parse(data).club_id;
    },
    async listClubMembers(clubId) {
      const { data, error } = await client
        .from(MEMBERS_TABLE)
        .select("user_id, full_name, email, account_status")
        .eq("club_id", clubId);
      if (error) {
        throw new Error(
          `No se pudieron leer los socios del club ${clubId}: ${error.message}`,
        );
      }
      return z
        .array(clubMemberRowSchema)
        .parse(data)
        .map((row) => ({
          userId: row.user_id,
          fullName: row.full_name,
          email: row.email,
          status: row.account_status,
        }));
    },
  };
}

export function createLevyPaymentsGateway(
  client: SupabaseClient,
): LevyPayersGateways["levyPayments"] {
  return {
    async listLevyPayments({ clubId, productId }) {
      const { data, error } = await client
        .from(PAYMENTS_TABLE)
        .select("user_id, amount_cents, status, paid_at, created_at")
        .eq("club_id", clubId)
        .eq("stripe_product_id", productId);
      if (error) {
        throw new Error(
          `No se pudieron leer los pagos del levy ${productId}: ${error.message}`,
        );
      }
      return z
        .array(levyPaymentRowSchema)
        .parse(data)
        .map((row) => ({
          userId: row.user_id,
          amountCents: row.amount_cents,
          status: row.status,
          // El webhook guarda un levy pagado siempre con la fecha del cargo.
          // Sólo una fila pendiente o fallida llega sin ella, y el dominio
          // la descarta. En ISO para que las ordene comparando textos.
          paidAt: new Date(row.paid_at ?? row.created_at).toISOString(),
        }));
    },
  };
}
