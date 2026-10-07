// @vitest-environment node
import { expect, it } from "vitest";
import { createFailedPaymentAlertGateway } from "@/lib/membership/supabase-failed-payment-gateway";
import {
  RLS_NETWORK_TEST_TIMEOUT_MS,
  type ServiceRoleClient,
  type TestUser,
  createRlsClient,
  createServiceRoleTestClient,
  describeRls,
  withSeededRows,
  withTestUser,
} from "../../support/rls";

/**
 * Lo que la cáscara lee para la alerta de pago fallido (#474) contra
 * `seadragons-dev`, con el cliente de la sesión del socio: su membresía en
 * `past_due` y la fecha de la última cuota fallida. Un pack fallido (un
 * cargo, sin factura) no cuenta.
 */

const SEEDED_CLUB = "victoria-seadragons";
const OLDER_FAILURE = "2026-09-01T03:00:00.000Z";
const LATEST_FAILURE = "2026-10-01T03:00:00.000Z";
const FAILED_PACK_CHARGE = "2026-10-05T03:00:00.000Z";
/** La cuota Full en centavos (CON-005): lo que cobraría la factura fallida. */
const FAILED_FEE_CENTS = 4500;

async function seededClubId(serviceClient: ServiceRoleClient): Promise<string> {
  const { data, error } = await serviceClient.client
    .from("clubs")
    .select("id")
    .eq("slug", SEEDED_CLUB)
    .single();
  if (error) {
    throw new Error(`No se pudo leer el club sembrado: ${error.message}`);
  }
  return String(data.id);
}

/** Un Full con el cobro fallido. La reserva le borra la fila de socio al
 * terminar, y con ella la membresía y los pagos en cascada. */
async function seedPastDueMember(
  serviceClient: ServiceRoleClient,
  input: { readonly clubId: string; readonly user: TestUser },
): Promise<void> {
  const { error: memberError } = await serviceClient.client
    .from("members")
    .insert({
      club_id: input.clubId,
      user_id: input.user.id,
      full_name: "Paula Pendiente",
      email: input.user.email,
      account_status: "active",
    });
  if (memberError) {
    throw new Error(`No se pudo sembrar el socio: ${memberError.message}`);
  }
  const { error } = await serviceClient.client.from("memberships").insert({
    user_id: input.user.id,
    club_id: input.clubId,
    plan: "Full",
    status: "past_due",
    stripe_subscription_id: `sub_alerta_${crypto.randomUUID()}`,
  });
  if (error) {
    throw new Error(`No se pudo sembrar la membresía: ${error.message}`);
  }
}

function failedPayment(
  input: { readonly clubId: string; readonly user: TestUser },
  reference: { readonly invoice: boolean; readonly createdAt: string },
): Record<string, unknown> {
  const stripeId = `rls_${crypto.randomUUID()}`;
  return {
    user_id: input.user.id,
    club_id: input.clubId,
    ...(reference.invoice
      ? { stripe_invoice_id: `in_${stripeId}` }
      : { stripe_charge_id: `ch_${stripeId}` }),
    amount_cents: FAILED_FEE_CENTS,
    currency: "aud",
    status: "failed",
    created_at: reference.createdAt,
  };
}

describeRls("la alerta de pago fallido", () => {
  it(
    "lee la membresía past_due y la fecha de la última cuota fallida, sin contar packs",
    async () => {
      const serviceClient = createServiceRoleTestClient(process.env);
      const clubId = await seededClubId(serviceClient);
      await withTestUser(serviceClient, async (user) => {
        const input = { clubId, user };
        await seedPastDueMember(serviceClient, input);
        await withSeededRows(
          serviceClient,
          "payments",
          [
            failedPayment(input, { invoice: true, createdAt: OLDER_FAILURE }),
            failedPayment(input, { invoice: true, createdAt: LATEST_FAILURE }),
            failedPayment(input, {
              invoice: false,
              createdAt: FAILED_PACK_CHARGE,
            }),
          ],
          async () => {
            const { client } = await createRlsClient(
              {
                role: "authenticated",
                email: user.email,
                password: user.password,
              },
              process.env,
            );
            const gateway = createFailedPaymentAlertGateway(client);

            const standing = await gateway.findStanding(user.id);
            const failedAt = await gateway.findLastFailedInvoiceAt(user.id);

            expect(standing?.status).toBe("past_due");
            expect(failedAt).toEqual(new Date(LATEST_FAILURE));
          },
        );
      });
    },
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );
});
