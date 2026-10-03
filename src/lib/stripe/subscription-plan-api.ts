import type Stripe from "stripe";
import type { SubscriptionPlanApi } from "@/lib/membership/plan-change";

/**
 * El cambio de plan al siguiente ciclo (#456, D5) contra la API de Stripe.
 *
 * Entre Full y Student se usa un `SubscriptionSchedule` y no un cambio de
 * precio en la suscripción. Cambiar el precio ya, aunque sea sin prorrateo,
 * lo deja puesto desde hoy: Stripe mandaría el precio nuevo en el siguiente
 * `customer.subscription.updated` y el webhook (#452) daría al socio por
 * Student semanas antes de tiempo. La programación deja la fase actual como
 * está hasta el fin del periodo y empieza la nueva ese día; Stripe avisa con
 * el precio nuevo justo cuando se aplica. Anular es soltarla
 * (`release`): la suscripción sigue con la fase actual.
 *
 * A Casual no hay precio: la suscripción se cancela al final del periodo
 * (`cancel_at_period_end`), y anularlo es quitar esa marca.
 */

/** Lo que se usa del cliente de Stripe: lo cumple `new Stripe(...)`. */
export type SubscriptionPlanClient = {
  readonly subscriptions: Pick<Stripe["subscriptions"], "retrieve" | "update">;
  readonly subscriptionSchedules: Pick<
    Stripe["subscriptionSchedules"],
    "create" | "retrieve" | "update" | "release"
  >;
};

const MILLISECONDS_PER_SECOND = 1000;

/** La fase nueva dura un mes y la programación se suelta al acabarla: la
 * suscripción sigue sola con el precio nuevo, cada mes (FR-063). */
const NEXT_PHASE_DURATION = { interval: "month", interval_count: 1 } as const;

function fromStripeTime(seconds: number): Date {
  return new Date(seconds * MILLISECONDS_PER_SECOND);
}

function idOf(reference: string | { readonly id: string }): string {
  return typeof reference === "string" ? reference : reference.id;
}

async function scheduleOf(
  client: SubscriptionPlanClient,
  subscriptionId: string,
): Promise<Stripe.SubscriptionSchedule> {
  const subscription = await client.subscriptions.retrieve(subscriptionId);
  if (subscription.schedule === null) {
    return client.subscriptionSchedules.create({
      from_subscription: subscriptionId,
    });
  }
  return client.subscriptionSchedules.retrieve(idOf(subscription.schedule));
}

function currentPhaseOf(
  schedule: Stripe.SubscriptionSchedule,
): Stripe.SubscriptionSchedule.Phase {
  const { current_phase: current } = schedule;
  const phase =
    current === null
      ? undefined
      : schedule.phases.find((each) => each.start_date === current.start_date);
  if (phase === undefined) {
    throw new Error(
      `La programación ${schedule.id} de Stripe no tiene fase en curso.`,
    );
  }
  return phase;
}

/** La fase en curso tal como está, con su prueba si la tiene: Stripe pide
 * repetirla para añadir la siguiente. */
function keepPhase(
  phase: Stripe.SubscriptionSchedule.Phase,
): Stripe.SubscriptionScheduleUpdateParams.Phase {
  return {
    items: phase.items.map((item) => ({
      price: idOf(item.price),
      ...(item.quantity === undefined ? {} : { quantity: item.quantity }),
    })),
    start_date: phase.start_date,
    end_date: phase.end_date,
    ...(phase.trial_end === null ? {} : { trial_end: phase.trial_end }),
    proration_behavior: "none",
  };
}

/** Una suscripción del club tiene un solo item, y desde la API de 2025 el
 * fin del periodo vive en él. */
function periodEndOf(subscription: Stripe.Subscription): Date {
  const item = subscription.items.data[0];
  if (item === undefined) {
    throw new Error(`La suscripción ${subscription.id} no tiene ningún plan.`);
  }
  return fromStripeTime(item.current_period_end);
}

/** Suelta la programación de la suscripción, si tiene: sigue con la fase en
 * curso. */
async function releaseSchedule(
  client: SubscriptionPlanClient,
  subscriptionId: string,
): Promise<void> {
  const subscription = await client.subscriptions.retrieve(subscriptionId);
  if (subscription.schedule !== null) {
    await client.subscriptionSchedules.release(idOf(subscription.schedule));
  }
}

export function createSubscriptionPlanApi(
  client: SubscriptionPlanClient,
): SubscriptionPlanApi {
  return {
    async schedulePriceChange({ subscriptionId, priceId }) {
      const schedule = await scheduleOf(client, subscriptionId);
      const current = currentPhaseOf(schedule);
      await client.subscriptionSchedules.update(schedule.id, {
        end_behavior: "release",
        proration_behavior: "none",
        phases: [
          keepPhase(current),
          {
            items: [{ price: priceId, quantity: 1 }],
            duration: NEXT_PHASE_DURATION,
            proration_behavior: "none",
          },
        ],
      });
      return fromStripeTime(current.end_date);
    },
    cancelPriceChange: (subscriptionId) =>
      releaseSchedule(client, subscriptionId),
    async cancelAtPeriodEnd(subscriptionId) {
      // Stripe no deja tocar `cancel_at_period_end` en una suscripción que
      // gobierna una programación: una que quedó puesta sin llegar a la base
      // (el guardado falló tras aceptarla Stripe) se suelta antes.
      await releaseSchedule(client, subscriptionId);
      const subscription = await client.subscriptions.update(subscriptionId, {
        cancel_at_period_end: true,
      });
      return periodEndOf(subscription);
    },
    async resumeSubscription(subscriptionId) {
      await client.subscriptions.update(subscriptionId, {
        cancel_at_period_end: false,
      });
    },
  };
}
