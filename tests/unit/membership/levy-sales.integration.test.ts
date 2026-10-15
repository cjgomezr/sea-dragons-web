// @vitest-environment node
import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { readLevyBuyers, readLevySales } from "@/lib/membership/levy-sales";
import { createClubMembersGateway } from "@/lib/membership/supabase-levy-payers-gateways";
import { createLevySalesPaymentsGateway } from "@/lib/membership/supabase-levy-sales-gateways";
import {
  RLS_NETWORK_TEST_TIMEOUT_MS,
  type ServiceRoleClient,
  type TestUser,
  createServiceRoleTestClient,
  describeRls,
  withTestUser,
} from "../../support/rls";

/**
 * El resumen de ventas de los extras y sus compradores contra
 * `seadragons-dev` (#634), con los adaptadores de verdad y pagos de varias
 * unidades. Stripe va doblado sin productos: el extra de la prueba es uno
 * borrado de Stripe, que es el caso que sólo la base resuelve. El producto es
 * único por corrida, así que los pagos de otros socios del club no cuentan.
 */

const SEEDED_CLUB = "victoria-seadragons";
const UNIT_CENTS = 4500;

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

async function seedMember(
  serviceClient: ServiceRoleClient,
  member: {
    readonly user: TestUser;
    readonly clubId: string;
    readonly fullName: string;
  },
): Promise<void> {
  const { error } = await serviceClient.client.from("members").insert({
    club_id: member.clubId,
    user_id: member.user.id,
    full_name: member.fullName,
    email: member.user.email,
    account_status: "active",
  });
  if (error) {
    throw new Error(`No se pudo sembrar el socio: ${error.message}`);
  }
}

type SeededPayment = {
  readonly user: TestUser;
  readonly quantity: number;
  readonly paidAt: string;
  readonly status?: "paid" | "failed";
};

/** Los pagos se borran en cascada con la ficha del socio al soltarlo. */
async function seedPayments(
  serviceClient: ServiceRoleClient,
  request: {
    readonly clubId: string;
    readonly productId: string;
    readonly payments: readonly SeededPayment[];
  },
): Promise<void> {
  const { error } = await serviceClient.client.from("payments").insert(
    request.payments.map((payment) => ({
      user_id: payment.user.id,
      club_id: request.clubId,
      stripe_charge_id: `ch_it_${randomUUID()}`,
      stripe_product_id: request.productId,
      amount_cents: UNIT_CENTS * payment.quantity,
      currency: "aud",
      description: "Hoodie 2025",
      status: payment.status ?? "paid",
      paid_at: payment.paidAt,
      quantity: payment.quantity,
    })),
  );
  if (error) {
    throw new Error(`No se pudieron sembrar los pagos: ${error.message}`);
  }
}

describeRls("el resumen de ventas de los extras contra la base", () => {
  it(
    "suma las unidades cobradas, cuenta los compradores y da una fila por compra",
    async () => {
      const serviceClient = createServiceRoleTestClient(process.env);
      const clubId = await seededClubId(serviceClient);
      const productId = `prod_it_${randomUUID()}`;
      await withTestUser(serviceClient, async (alba) => {
        await withTestUser(serviceClient, async (bruno) => {
          await seedMember(serviceClient, {
            user: alba,
            clubId,
            fullName: "Alba Ruiz",
          });
          await seedMember(serviceClient, {
            user: bruno,
            clubId,
            fullName: "Bruno Díaz",
          });
          await seedPayments(serviceClient, {
            clubId,
            productId,
            payments: [
              { user: alba, quantity: 2, paidAt: "2026-10-01T10:00:00Z" },
              { user: alba, quantity: 1, paidAt: "2026-10-05T10:00:00Z" },
              { user: bruno, quantity: 3, paidAt: "2026-10-03T10:00:00Z" },
              {
                user: bruno,
                quantity: 4,
                paidAt: "2026-10-04T10:00:00Z",
                status: "failed",
              },
            ],
          });
          const clubMembers = createClubMembersGateway(serviceClient.client);
          const levyPayments = createLevySalesPaymentsGateway(
            serviceClient.client,
          );

          const sales = await readLevySales(
            {
              clubMembers,
              levyPayments,
              stripe: {
                kind: "configured",
                products: { listProducts: async () => [] },
              },
            },
            { callerId: alba.id },
          );
          const buyers = await readLevyBuyers(
            { clubMembers, levyPayments },
            { callerId: alba.id, productId },
          );

          expect(
            sales.kind === "read" &&
              sales.sales.find((sale) => sale.productId === productId),
          ).toEqual({
            productId,
            priceId: null,
            name: "Hoodie 2025",
            description: null,
            amountCents: UNIT_CENTS,
            status: "closed",
            soldQuantity: 6,
            buyerCount: 2,
          });
          expect(
            buyers.map(({ fullName, quantity, paidAt, amountCents }) => [
              fullName,
              quantity,
              paidAt,
              amountCents,
            ]),
          ).toEqual([
            ["Alba Ruiz", 1, "2026-10-05T10:00:00.000Z", UNIT_CENTS],
            ["Bruno Díaz", 3, "2026-10-03T10:00:00.000Z", 3 * UNIT_CENTS],
            ["Alba Ruiz", 2, "2026-10-01T10:00:00.000Z", 2 * UNIT_CENTS],
          ]);
        });
      });
    },
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );
});
