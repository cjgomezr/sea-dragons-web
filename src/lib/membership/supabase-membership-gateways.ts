import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { MEMBERSHIP_TYPES } from "@/lib/auth/registration";
import {
  MEMBERSHIP_STATUSES,
  type MembershipCard,
  type MembershipGateway,
  type MembershipPlan,
  type MembershipRecord,
  type MembershipStanding,
  type MembershipStatus,
  type MembershipWaiver,
  resolveStandingStatus,
} from "./membership";
import type { StripeWebhookGateway } from "@/lib/stripe/stripe-webhook";
import type { MemberEmailGateway } from "./checkout";
import {
  PAYMENT_STATUSES,
  type PaymentHistoryGateway,
} from "./membership-view";
import type {
  MembershipChanges,
  MembershipLookup,
  StripeMembership,
  StripePayment,
} from "@/lib/stripe/webhook-events";

/**
 * Adaptador entre la membresía (#451) y Supabase.
 *
 * Va por la llave de servicio: `authenticated` sólo lee su propia fila
 * (`0050_memberships.sql`) y no escribe ninguna.
 */

const MEMBERSHIPS_TABLE = "memberships";
const MEMBERSHIP_COLUMNS =
  "user_id, club_id, plan, status, stripe_customer_id, stripe_subscription_id, current_period_end, trial_end, card_brand, card_last4, card_exp_month, card_exp_year, waived_reason, waived_until, waived_by";
const PENDING_STATUS = "pending";

const membershipRowSchema = z.object({
  user_id: z.string(),
  club_id: z.string(),
  plan: z.enum(MEMBERSHIP_TYPES).nullable(),
  status: z.enum(MEMBERSHIP_STATUSES),
  stripe_customer_id: z.string().nullable(),
  stripe_subscription_id: z.string().nullable(),
  current_period_end: z.string().nullable(),
  trial_end: z.string().nullable(),
  card_brand: z.string().nullable(),
  card_last4: z.string().nullable(),
  card_exp_month: z.number().int().nullable(),
  card_exp_year: z.number().int().nullable(),
  waived_reason: z.string().nullable(),
  waived_until: z.string().nullable(),
  waived_by: z.string().nullable(),
});

type MembershipRow = z.infer<typeof membershipRowSchema>;

/**
 * La membresía como `left join` desde `members` (#453), con lo justo para
 * saber si está al día. `memberships` tiene dos claves foráneas hacia
 * `members` (el socio y quien lo eximió), así que se nombra la del socio: sin
 * ella PostgREST no sabe cuál seguir y la consulta falla.
 */
export const MEMBERSHIP_STANDING_EMBED =
  "memberships!memberships_member_same_club_fkey(status, stripe_subscription_id, trial_end, current_period_end, waived_until)";

const standingRowSchema = z.object({
  status: z.enum(MEMBERSHIP_STATUSES),
  stripe_subscription_id: z.string().nullable(),
  trial_end: z.string().nullable(),
  current_period_end: z.string().nullable(),
  waived_until: z.string().nullable(),
});

/** La clave primaria de `memberships` es la foránea, así que PostgREST la
 * embebe como un objeto; se acepta también la lista de una fila por si una
 * versión la sirve así. Ausente o vacía, el socio no tiene membresía. */
const embeddedStandingSchema = z
  .union([standingRowSchema, z.array(standingRowSchema).max(1)])
  .nullish();

export function parseMembershipStanding(
  embedded: unknown,
): MembershipStanding | null {
  const parsed = embeddedStandingSchema.parse(embedded);
  const row = Array.isArray(parsed) ? parsed[0] : parsed;
  if (row === undefined || row === null) {
    return null;
  }
  return {
    status: row.status,
    stripeSubscriptionId: row.stripe_subscription_id,
    trialEnd: toDate(row.trial_end),
    currentPeriodEnd: toDate(row.current_period_end),
    waivedUntil: toDate(row.waived_until),
  };
}

/** El estado que cuenta hoy de la membresía embebida, o `null` si el socio
 * no tiene: lo que enseña el chip del Admin (#453). */
export function readEmbeddedMembershipStatus(
  embedded: unknown,
  now: Date,
): MembershipStatus | null {
  const standing = parseMembershipStanding(embedded);
  return standing === null ? null : resolveStandingStatus(standing, now);
}

function toDate(value: string | null): Date | null {
  return value === null ? null : new Date(value);
}

/** El webhook (#452) guarda los cuatro datos juntos: sin alguno no hay tarjeta. */
function toCard(row: MembershipRow): MembershipCard | null {
  const { card_brand, card_last4, card_exp_month, card_exp_year } = row;
  if (
    card_brand === null ||
    card_last4 === null ||
    card_exp_month === null ||
    card_exp_year === null
  ) {
    return null;
  }
  return {
    brand: card_brand,
    last4: card_last4,
    expMonth: card_exp_month,
    expYear: card_exp_year,
  };
}

function toWaiver(row: MembershipRow): MembershipWaiver | null {
  if (row.waived_reason === null) {
    return null;
  }
  return {
    reason: row.waived_reason,
    until: toDate(row.waived_until),
    waivedBy: row.waived_by,
  };
}

function toMembershipRecord(row: MembershipRow): MembershipRecord {
  return {
    userId: row.user_id,
    clubId: row.club_id,
    plan: row.plan,
    status: row.status,
    stripeCustomerId: row.stripe_customer_id,
    stripeSubscriptionId: row.stripe_subscription_id,
    currentPeriodEnd: toDate(row.current_period_end),
    trialEnd: toDate(row.trial_end),
    card: toCard(row),
    waiver: toWaiver(row),
  };
}

export function createMembershipGateway(
  serviceClient: SupabaseClient,
): MembershipGateway {
  return {
    async findByUserId(userId) {
      const { data, error } = await serviceClient
        .from(MEMBERSHIPS_TABLE)
        .select(MEMBERSHIP_COLUMNS)
        .eq("user_id", userId)
        .maybeSingle();
      if (error) {
        throw new Error(
          `No se pudo leer la membresía de ${userId}: ${error.message}`,
        );
      }
      return data === null
        ? null
        : toMembershipRecord(membershipRowSchema.parse(data));
    },
  };
}

const PAYMENTS_TABLE = "payments";
const PAYMENT_COLUMNS =
  "id, amount_cents, description, status, paid_at, created_at";

const paymentRowSchema = z.object({
  id: z.string(),
  amount_cents: z.number().int(),
  description: z.string().nullable(),
  status: z.enum(PAYMENT_STATUSES),
  paid_at: z.string().nullable(),
  created_at: z.string(),
});

/** El historial de pagos de un socio (#455). Con el cliente de la sesión,
 * `payments_select_own` sólo deja leer los propios. El orden lo pone el
 * dominio, que fecha cada pago por cuándo se cobró. */
export function createPaymentHistoryGateway(
  client: SupabaseClient,
): PaymentHistoryGateway {
  return {
    async listByUserId(userId) {
      const { data, error } = await client
        .from(PAYMENTS_TABLE)
        .select(PAYMENT_COLUMNS)
        .eq("user_id", userId);
      if (error) {
        throw new Error(
          `No se pudieron leer los pagos de ${userId}: ${error.message}`,
        );
      }
      return z
        .array(paymentRowSchema)
        .parse(data)
        .map((row) => ({
          id: row.id,
          amountCents: row.amount_cents,
          description: row.description,
          status: row.status,
          paidAt: toDate(row.paid_at),
          createdAt: new Date(row.created_at),
        }));
    },
  };
}

const STRIPE_MEMBERSHIP_COLUMNS = `${MEMBERSHIP_COLUMNS}, stripe_event_at`;
const APPLY_STRIPE_EVENT_FUNCTION = "apply_stripe_event";
const APPLY_STRIPE_EVENT_OUTCOMES = ["applied", "duplicate"] as const;

const stripeMembershipRowSchema = membershipRowSchema.extend({
  stripe_event_at: z.string().nullable(),
});

/** De lo más preciso a lo menos: la suscripción es de una sola membresía; el
 * socio de los metadatos, sólo un respaldo para cuando la suscripción llega
 * antes que el Checkout que la guarda. */
function lookupColumns(
  lookup: MembershipLookup,
): readonly (readonly [column: string, value: string])[] {
  const candidates = [
    ["stripe_subscription_id", lookup.subscriptionId],
    ["stripe_customer_id", lookup.customerId],
    ["user_id", lookup.userId],
  ] as const;
  return candidates.flatMap(([column, value]) =>
    value === null ? [] : [[column, value] as const],
  );
}

/** `maybeSingle` lanza si hay más de una fila, y por `user_id` las habrá el
 * día que un socio lo sea de dos clubes (NFR-009). Release 1 opera uno solo;
 * con varios, el webhook tendrá que saber de qué club es la cuenta de Stripe. */
async function findMembershipBy(
  serviceClient: SupabaseClient,
  [column, value]: readonly [string, string],
): Promise<StripeMembership | null> {
  const { data, error } = await serviceClient
    .from(MEMBERSHIPS_TABLE)
    .select(STRIPE_MEMBERSHIP_COLUMNS)
    .eq(column, value)
    .maybeSingle();
  if (error) {
    throw new Error(
      `No se pudo buscar la membresía por ${column}: ${error.message}`,
    );
  }
  if (data === null) {
    return null;
  }
  const row = stripeMembershipRowSchema.parse(data);
  return {
    record: toMembershipRecord(row),
    lastStripeEventAt: toDate(row.stripe_event_at),
  };
}

function toNullableIso(date: Date | null): string | null {
  return date === null ? null : date.toISOString();
}

/** Sólo las claves que el evento cambia: la función no toca las ausentes. */
function toMembershipChangesJson(
  changes: MembershipChanges,
): Record<string, unknown> {
  const { card } = changes;
  return {
    ...(changes.status === undefined ? {} : { status: changes.status }),
    ...(changes.plan === undefined ? {} : { plan: changes.plan }),
    ...(changes.stripeCustomerId === undefined
      ? {}
      : { stripe_customer_id: changes.stripeCustomerId }),
    ...(changes.stripeSubscriptionId === undefined
      ? {}
      : { stripe_subscription_id: changes.stripeSubscriptionId }),
    ...(changes.trialEnd === undefined
      ? {}
      : { trial_end: toNullableIso(changes.trialEnd) }),
    ...(changes.currentPeriodEnd === undefined
      ? {}
      : { current_period_end: toNullableIso(changes.currentPeriodEnd) }),
    ...(card === undefined
      ? {}
      : {
          card_brand: card.brand,
          card_last4: card.last4,
          card_exp_month: card.expMonth,
          card_exp_year: card.expYear,
        }),
    ...(changes.stripeEventAt === undefined
      ? {}
      : { stripe_event_at: changes.stripeEventAt.toISOString() }),
  };
}

function toPaymentJson(payment: StripePayment): Record<string, unknown> {
  return {
    stripe_invoice_id: payment.invoiceId,
    amount_cents: payment.amountCents,
    currency: payment.currency,
    description: payment.description,
    status: payment.status,
    paid_at: toNullableIso(payment.paidAt),
  };
}

/** Lo que necesita el webhook de Stripe (#452): encontrar la membresía de un
 * evento y escribirlo todo de una vez con `apply_stripe_event`
 * (`0051_apply_stripe_event.sql`). */
export function createStripeWebhookGateway(
  serviceClient: SupabaseClient,
): StripeWebhookGateway {
  return {
    async findMembership(lookup) {
      for (const candidate of lookupColumns(lookup)) {
        const membership = await findMembershipBy(serviceClient, candidate);
        if (membership !== null) {
          return membership;
        }
      }
      return null;
    },
    async applyEvent({ event, owner, writes }) {
      const { data, error } = await serviceClient.rpc(
        APPLY_STRIPE_EVENT_FUNCTION,
        {
          event_id: event.id,
          event_type: event.type,
          event_created: event.created.toISOString(),
          target_user_id: owner.userId,
          target_club_id: owner.clubId,
          membership_changes:
            writes.membership === null
              ? null
              : toMembershipChangesJson(writes.membership),
          payment:
            writes.payment === null ? null : toPaymentJson(writes.payment),
        },
      );
      if (error) {
        throw new Error(
          `No se pudo aplicar el evento de Stripe ${event.id}: ${error.message}`,
        );
      }
      return z.enum(APPLY_STRIPE_EVENT_OUTCOMES).parse(data);
    },
  };
}

type MembershipOwner = {
  readonly userId: string;
  readonly clubId: string;
  readonly plan: MembershipPlan | null;
};

/**
 * La membresía con la que nace una cuenta activa (RF-1). Si ya existe (la del
 * relleno de `0050`, o una activación repetida) se deja como está: nunca se
 * duplica ni vuelve a `pending`. Lo único que se le completa es el plan, si
 * el relleno la creó antes de que el socio lo eligiera.
 */
export async function ensurePendingMembership(
  serviceClient: SupabaseClient,
  member: MembershipOwner,
): Promise<void> {
  await insertMembershipIfMissing(serviceClient, member);
  if (member.plan !== null) {
    await fillMissingPlan(serviceClient, { ...member, plan: member.plan });
  }
}

async function fillMissingPlan(
  serviceClient: SupabaseClient,
  member: MembershipOwner & { readonly plan: MembershipPlan },
): Promise<void> {
  const { error } = await serviceClient
    .from(MEMBERSHIPS_TABLE)
    .update({ plan: member.plan, updated_at: new Date().toISOString() })
    .eq("user_id", member.userId)
    .eq("club_id", member.clubId)
    .is("plan", null);
  if (error) {
    throw new Error(
      `No se pudo poner el plan a la membresía de ${member.userId}: ${error.message}`,
    );
  }
}

async function insertMembershipIfMissing(
  serviceClient: SupabaseClient,
  member: MembershipOwner,
): Promise<void> {
  const { error } = await serviceClient.from(MEMBERSHIPS_TABLE).upsert(
    {
      user_id: member.userId,
      club_id: member.clubId,
      plan: member.plan,
      status: PENDING_STATUS,
    },
    { onConflict: "user_id,club_id", ignoreDuplicates: true },
  );
  if (error) {
    throw new Error(
      `No se pudo crear la membresía de ${member.userId}: ${error.message}`,
    );
  }
}

const MEMBERS_TABLE = "members";
const memberEmailRowSchema = z.object({ email: z.string() });

/** El correo con el que Checkout crea el cliente de Stripe (#454). Es la
 * copia de `members`, la misma que leen el directorio y los avisos. Va por la
 * llave de servicio, acotada al id de quien llama. */
export function createMemberEmailGateway(
  serviceClient: SupabaseClient,
): MemberEmailGateway {
  return {
    async findEmail(userId) {
      const { data, error } = await serviceClient
        .from(MEMBERS_TABLE)
        .select("email")
        .eq("user_id", userId)
        .single();
      if (error) {
        throw new Error(
          `No se pudo leer el correo de ${userId}: ${error.message}`,
        );
      }
      return memberEmailRowSchema.parse(data).email;
    },
  };
}
