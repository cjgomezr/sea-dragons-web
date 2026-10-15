// @vitest-environment node
import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { createStripeWebhookGateway } from "@/lib/membership/supabase-membership-gateways";
import type { StripeWebhookGateway } from "@/lib/stripe/stripe-webhook";
import type { RecordedPayment } from "@/lib/stripe/webhook-events";
import {
  RLS_NETWORK_TEST_TIMEOUT_MS,
  type ServiceRoleClient,
  type TestUser,
  createServiceRoleTestClient,
  describeRls,
  withTestUser,
} from "../../support/rls";

/**
 * La tarjeta y el motivo de cada cobro contra la base (#629), con el
 * adaptador del webhook y `0066_payment_charge_details.sql` de verdad. Lo que
 * Stripe responde ya lo prueban los unitarios: aquí se prueba que cada tipo
 * de pago escribe sus columnas, y que el mismo evento no las cambia.
 */

const SEEDED_CLUB = "victoria-seadragons";
const EVENT_CREATED = new Date("2026-10-01T10:00:00Z");
const VISA = { brand: "visa", last4: "4242" } as const;
const MASTERCARD = { brand: "mastercard", last4: "4444" } as const;
const DECLINED = "Your card was declined.";

type Owner = { readonly userId: string; readonly clubId: string };

type ChargeColumns = {
  readonly status: string;
  readonly card_brand: string | null;
  readonly card_last4: string | null;
  readonly failure_reason: string | null;
};

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

/** La reserva borra la fila de socio al terminar, y con ella su membresía y
 * sus pagos en cascada. Los eventos de Stripe se borran aparte. */
async function withMember(
  serviceClient: ServiceRoleClient,
  run: (owner: Owner) => Promise<void>,
): Promise<void> {
  const clubId = await seededClubId(serviceClient);
  await withTestUser(serviceClient, async (user: TestUser) => {
    const { error: memberError } = await serviceClient.client
      .from("members")
      .insert({
        club_id: clubId,
        user_id: user.id,
        full_name: "Tania Tarjeta",
        email: user.email,
        account_status: "active",
      });
    if (memberError) {
      throw new Error(`No se pudo sembrar el socio: ${memberError.message}`);
    }
    const { error } = await serviceClient.client
      .from("memberships")
      .insert({ user_id: user.id, club_id: clubId, plan: "Casual" });
    if (error) {
      throw new Error(`No se pudo sembrar la membresía: ${error.message}`);
    }
    await run({ userId: user.id, clubId });
  });
}

async function readCharges(
  serviceClient: ServiceRoleClient,
  owner: Owner,
): Promise<readonly ChargeColumns[]> {
  const { data, error } = await serviceClient.client
    .from("payments")
    .select("status, card_brand, card_last4, failure_reason")
    .eq("user_id", owner.userId)
    .order("created_at");
  if (error) {
    throw new Error(`No se pudieron leer los pagos: ${error.message}`);
  }
  return data;
}

async function deleteEvents(
  serviceClient: ServiceRoleClient,
  ids: readonly string[],
): Promise<void> {
  const { error } = await serviceClient.client
    .from("stripe_events")
    .delete()
    .in("id", ids);
  if (error) {
    throw new Error(`No se pudieron borrar los eventos: ${error.message}`);
  }
}

function invoicePayment(
  invoiceId: string,
  change: Partial<RecordedPayment>,
): RecordedPayment {
  return {
    invoiceId,
    amountCents: 4500,
    currency: "aud",
    description: "Full membership",
    status: "paid",
    paidAt: EVENT_CREATED,
    card: null,
    failureReason: null,
    ...change,
  };
}

function applyInvoice(
  gateway: StripeWebhookGateway,
  request: {
    readonly owner: Owner;
    readonly eventId: string;
    readonly payment: RecordedPayment;
  },
): Promise<"applied" | "duplicate"> {
  return gateway.applyEvent({
    event: {
      id: request.eventId,
      type: `invoice.${request.payment.status}`,
      created: EVENT_CREATED,
    },
    owner: request.owner,
    writes: { membership: null, payment: request.payment, warnings: [] },
  });
}

function chargePayment(description: string): {
  readonly paymentIntentId: string;
  readonly amountCents: number;
  readonly currency: string;
  readonly description: string;
  readonly paidAt: Date;
} {
  return {
    paymentIntentId: `pi_it_${randomUUID()}`,
    amountCents: 2500,
    currency: "aud",
    description,
    paidAt: EVENT_CREATED,
  };
}

describeRls("la tarjeta y el motivo de cada cobro contra la base", () => {
  it(
    "una cuota fallida guarda su tarjeta y su motivo, el reintento la deja pagada sin motivo y el repetido no cambia nada",
    async () => {
      const serviceClient = createServiceRoleTestClient(process.env);
      const gateway = createStripeWebhookGateway(serviceClient.client);
      await withMember(serviceClient, async (owner) => {
        const invoiceId = `in_it_${randomUUID()}`;
        const failedEvent = `evt_${randomUUID()}`;
        const paidEvent = `evt_${randomUUID()}`;
        try {
          await applyInvoice(gateway, {
            owner,
            eventId: failedEvent,
            payment: invoicePayment(invoiceId, {
              status: "failed",
              paidAt: null,
              card: VISA,
              failureReason: DECLINED,
            }),
          });
          const afterFailure = await readCharges(serviceClient, owner);
          await applyInvoice(gateway, {
            owner,
            eventId: paidEvent,
            payment: invoicePayment(invoiceId, { card: MASTERCARD }),
          });
          const repeated = await applyInvoice(gateway, {
            owner,
            eventId: paidEvent,
            payment: invoicePayment(invoiceId, { card: VISA }),
          });

          expect(afterFailure).toEqual([
            {
              status: "failed",
              card_brand: "visa",
              card_last4: "4242",
              failure_reason: DECLINED,
            },
          ]);
          expect(repeated).toBe("duplicate");
          await expect(readCharges(serviceClient, owner)).resolves.toEqual([
            {
              status: "paid",
              card_brand: "mastercard",
              card_last4: "4444",
              failure_reason: null,
            },
          ]);
        } finally {
          await deleteEvents(serviceClient, [failedEvent, paidEvent]);
        }
      });
    },
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );

  it(
    "un pack y un levy guardan la tarjeta del cobro, y repetidos no se duplican",
    async () => {
      const serviceClient = createServiceRoleTestClient(process.env);
      const gateway = createStripeWebhookGateway(serviceClient.client);
      await withMember(serviceClient, async (owner) => {
        const packEvent = {
          id: `evt_${randomUUID()}`,
          type: "checkout.session.completed",
          created: EVENT_CREATED,
        };
        const levyEvent = { ...packEvent, id: `evt_${randomUUID()}` };
        const pack = {
          event: packEvent,
          owner,
          sessions: 5,
          payment: chargePayment("Casual session pack (5 sessions)"),
          card: VISA,
        };
        const levy = {
          event: levyEvent,
          owner,
          payment: {
            ...chargePayment("Nationals 2026"),
            productId: `prod_it_${randomUUID()}`,
          },
          quantity: 1,
          card: MASTERCARD,
        };
        try {
          await gateway.applySessionPackPayment(pack);
          await gateway.applyLevyPayment(levy);
          const repeatedPack = await gateway.applySessionPackPayment(pack);
          const repeatedLevy = await gateway.applyLevyPayment(levy);

          expect([repeatedPack, repeatedLevy]).toEqual([
            "duplicate",
            "duplicate",
          ]);
          const charges = await readCharges(serviceClient, owner);
          expect(charges).toHaveLength(2);
          expect(charges).toEqual(
            expect.arrayContaining([
              {
                status: "paid",
                card_brand: "visa",
                card_last4: "4242",
                failure_reason: null,
              },
              {
                status: "paid",
                card_brand: "mastercard",
                card_last4: "4444",
                failure_reason: null,
              },
            ]),
          );
        } finally {
          await deleteEvents(serviceClient, [packEvent.id, levyEvent.id]);
        }
      });
    },
    RLS_NETWORK_TEST_TIMEOUT_MS,
  );
});
