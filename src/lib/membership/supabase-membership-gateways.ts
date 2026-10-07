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
  type ScheduledPlanChange,
  resolveStandingStatus,
} from "./membership";
import type { StripeWebhookGateway } from "@/lib/stripe/stripe-webhook";
import type { MemberEmailGateway } from "./checkout";
import type { PlanChoiceGateway } from "./choose-plan";
import type { LevyGateways } from "./levies";
import type { ScheduledPlanChangeGateway } from "./plan-change";
import type {
  SessionLedgerGateway,
  SessionMovement,
  SessionTraining,
} from "./session-balance";
import {
  type MembershipWaiverView,
  PAYMENT_STATUSES,
  type PaymentHistoryGateway,
} from "./membership-view";
import type {
  LevyPayment,
  MembershipChanges,
  MembershipLookup,
  SessionPackPayment,
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
  "user_id, club_id, plan, status, stripe_customer_id, stripe_subscription_id, current_period_end, trial_end, card_brand, card_last4, card_exp_month, card_exp_year, waived_reason, waived_until, waived_by, scheduled_plan, scheduled_at";
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
  scheduled_plan: z.enum(MEMBERSHIP_TYPES).nullable(),
  scheduled_at: z.string().nullable(),
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

function toStanding(
  row: z.infer<typeof standingRowSchema>,
): MembershipStanding {
  return {
    status: row.status,
    stripeSubscriptionId: row.stripe_subscription_id,
    trialEnd: toDate(row.trial_end),
    currentPeriodEnd: toDate(row.current_period_end),
    waivedUntil: toDate(row.waived_until),
  };
}

/** La fila embebida, o `null` si el socio no tiene membresía. */
function singleEmbeddedRow<Row extends object>(
  parsed: Row | Row[] | null | undefined,
): Row | null {
  if (Array.isArray(parsed)) {
    return parsed[0] ?? null;
  }
  return parsed ?? null;
}

export function parseMembershipStanding(
  embedded: unknown,
): MembershipStanding | null {
  const row = singleEmbeddedRow(embeddedStandingSchema.parse(embedded));
  return row === null ? null : toStanding(row);
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

/** La membresía embebida con el motivo de la exención: lo que la ficha del
 * Admin enseña (#457). */
export const MEMBERSHIP_SUMMARY_EMBED =
  "memberships!memberships_member_same_club_fkey(status, stripe_subscription_id, trial_end, current_period_end, waived_until, waived_reason)";

const summaryRowSchema = standingRowSchema.extend({
  waived_reason: z.string().nullable(),
});

const embeddedSummarySchema = z
  .union([summaryRowSchema, z.array(summaryRowSchema).max(1)])
  .nullish();

/** El estado que cuenta hoy y la exención, si está exento hoy. */
export type MembershipSummary = {
  readonly status: MembershipStatus | null;
  readonly waiver: MembershipWaiverView | null;
};

export function readEmbeddedMembershipSummary(
  embedded: unknown,
  now: Date,
): MembershipSummary {
  const row = singleEmbeddedRow(embeddedSummarySchema.parse(embedded));
  if (row === null) {
    return { status: null, waiver: null };
  }
  const status = resolveStandingStatus(toStanding(row), now);
  if (status !== "waived" || row.waived_reason === null) {
    return { status, waiver: null };
  }
  return {
    status,
    waiver: {
      reason: row.waived_reason,
      until: toNullableIso(toDate(row.waived_until)),
    },
  };
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

/** La base guarda el plan y la fecha juntos
 * (`memberships_scheduled_change_check`): sin alguno no hay cambio. */
function toScheduledChange(row: MembershipRow): ScheduledPlanChange | null {
  if (row.scheduled_plan === null || row.scheduled_at === null) {
    return null;
  }
  return { plan: row.scheduled_plan, effectiveAt: new Date(row.scheduled_at) };
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
    scheduledChange: toScheduledChange(row),
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

const paidProductRowSchema = z.object({ stripe_product_id: z.string() });

/** Los productos de Stripe que un socio ya pagó (#473): qué levies le salen
 * como pagados. Un pago fallido o pendiente no cuenta. */
export function createPaidProductsGateway(
  client: SupabaseClient,
): LevyGateways["paidProducts"] {
  return {
    async findPaidProductIds(userId) {
      const { data, error } = await client
        .from(PAYMENTS_TABLE)
        .select("stripe_product_id")
        .eq("user_id", userId)
        .eq("status", "paid")
        .not("stripe_product_id", "is", null);
      if (error) {
        throw new Error(
          `No se pudieron leer los productos pagados de ${userId}: ${error.message}`,
        );
      }
      const rows = z.array(paidProductRowSchema).parse(data);
      return new Set(rows.map((row) => row.stripe_product_id));
    },
  };
}

const SESSION_LEDGER_TABLE = "session_ledger";
const SESSION_LEDGER_COLUMNS =
  "id, kind, delta, pack_payment_id, attendance_event_id, created_at";

/** `session_ledger_reference_check` ata cada tipo a su referencia; el
 * esquema lo vuelve a decir para que el dominio reciba la unión ya cerrada. */
const sessionMovementRowSchema = z.discriminatedUnion("kind", [
  z.object({
    id: z.string(),
    kind: z.literal("pack_purchase"),
    delta: z.number().int().positive(),
    pack_payment_id: z.string(),
    created_at: z.string(),
  }),
  z.object({
    id: z.string(),
    kind: z.literal("attendance"),
    delta: z.literal(-1),
    attendance_event_id: z.string(),
    created_at: z.string(),
  }),
]);

type SessionMovementRow = z.infer<typeof sessionMovementRowSchema>;

const EVENTS_TABLE = "events";
const SESSION_TRAINING_COLUMNS = "id, title, starts_on";

const sessionTrainingRowSchema = z.object({
  id: z.string(),
  title: z.string(),
  starts_on: z.string(),
});

type TrainingsById = ReadonlyMap<string, SessionTraining>;

function toSessionMovement(
  row: SessionMovementRow,
  trainings: TrainingsById,
): SessionMovement {
  const createdAt = new Date(row.created_at);
  return row.kind === "pack_purchase"
    ? {
        kind: row.kind,
        id: row.id,
        delta: row.delta,
        paymentId: row.pack_payment_id,
        createdAt,
      }
    : {
        kind: row.kind,
        id: row.id,
        delta: row.delta,
        eventId: row.attendance_event_id,
        training: trainings.get(row.attendance_event_id) ?? null,
        createdAt,
      };
}

/** El título y el día de los entrenamientos que gastaron sesiones (#472).
 * Va con el mismo cliente: `events_select_audience` calla los eventos que el
 * socio ya no ve, y esos movimientos salen sin entrenamiento. */
async function readSessionTrainings(
  client: SupabaseClient,
  rows: readonly SessionMovementRow[],
): Promise<TrainingsById> {
  const eventIds = rows.flatMap((row) =>
    row.kind === "attendance" ? [row.attendance_event_id] : [],
  );
  if (eventIds.length === 0) {
    return new Map();
  }
  const { data, error } = await client
    .from(EVENTS_TABLE)
    .select(SESSION_TRAINING_COLUMNS)
    .in("id", eventIds);
  if (error) {
    throw new Error(
      `No se pudieron leer los entrenamientos del saldo de sesiones: ${error.message}`,
    );
  }
  return new Map(
    z
      .array(sessionTrainingRowSchema)
      .parse(data)
      .map((row) => [row.id, { title: row.title, startsOn: row.starts_on }]),
  );
}

/** Los movimientos del saldo de un socio (#468) con sus entrenamientos
 * (#472). Con el cliente de la sesión, `session_ledger_select_own` sólo deja
 * leer los propios. El orden lo pone el dominio. */
export function createSessionLedgerGateway(
  client: SupabaseClient,
): SessionLedgerGateway {
  return {
    async listByUserId(userId) {
      const { data, error } = await client
        .from(SESSION_LEDGER_TABLE)
        .select(SESSION_LEDGER_COLUMNS)
        .eq("user_id", userId);
      if (error) {
        throw new Error(
          `No se pudo leer el saldo de sesiones de ${userId}: ${error.message}`,
        );
      }
      const rows = z.array(sessionMovementRowSchema).parse(data);
      const trainings = await readSessionTrainings(client, rows);
      return rows.map((row) => toSessionMovement(row, trainings));
    },
  };
}

const STRIPE_MEMBERSHIP_COLUMNS = `${MEMBERSHIP_COLUMNS}, stripe_event_at`;
const APPLY_STRIPE_EVENT_FUNCTION = "apply_stripe_event";
const APPLY_SESSION_PACK_PAYMENT_FUNCTION = "apply_session_pack_payment";
const APPLY_LEVY_PAYMENT_FUNCTION = "apply_levy_payment";
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
    ...(changes.scheduledChange === undefined
      ? {}
      : { scheduled_plan: null, scheduled_at: null }),
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

/** Un pack se guarda por su PaymentIntent: es un cobro suelto, sin factura
 * (#471). Siempre pagado: uno sin pagar no llega hasta aquí. */
function toSessionPackPaymentJson(
  payment: SessionPackPayment,
): Record<string, unknown> {
  return {
    stripe_charge_id: payment.paymentIntentId,
    amount_cents: payment.amountCents,
    currency: payment.currency,
    description: payment.description,
    paid_at: payment.paidAt.toISOString(),
  };
}

/** Un levy se guarda como un pack, y además con el producto de Stripe que
 * dice cuál pagó el socio (#473). */
function toLevyPaymentJson(payment: LevyPayment): Record<string, unknown> {
  return {
    ...toSessionPackPaymentJson(payment),
    stripe_product_id: payment.productId,
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
    async applySessionPackPayment({ event, owner, sessions, payment }) {
      const { data, error } = await serviceClient.rpc(
        APPLY_SESSION_PACK_PAYMENT_FUNCTION,
        {
          event_id: event.id,
          event_type: event.type,
          event_created: event.created.toISOString(),
          target_user_id: owner.userId,
          target_club_id: owner.clubId,
          payment: toSessionPackPaymentJson(payment),
          pack_sessions: sessions,
        },
      );
      if (error) {
        throw new Error(
          `No se pudo aplicar el pack del evento de Stripe ${event.id}: ${error.message}`,
        );
      }
      return z.enum(APPLY_STRIPE_EVENT_OUTCOMES).parse(data);
    },
    async applyLevyPayment({ event, owner, payment }) {
      const { data, error } = await serviceClient.rpc(
        APPLY_LEVY_PAYMENT_FUNCTION,
        {
          event_id: event.id,
          event_type: event.type,
          event_created: event.created.toISOString(),
          target_user_id: owner.userId,
          target_club_id: owner.clubId,
          payment: toLevyPaymentJson(payment),
        },
      );
      if (error) {
        throw new Error(
          `No se pudo aplicar el levy del evento de Stripe ${event.id}: ${error.message}`,
        );
      }
      return z.enum(APPLY_STRIPE_EVENT_OUTCOMES).parse(data);
    },
  };
}

/** Los estados guardados en los que se puede elegir plan (#479): sin pagar
 * todavía, o con una exención que ya venció. Una exención vigente que un
 * Admin concede entre la lectura y la escritura no deja pasar el cambio. */
function planChoiceStatusFilter(now: Date): string {
  return `status.in.(pending,cancelled),and(status.eq.waived,waived_until.lte.${now.toISOString()})`;
}

/** Guarda el plan que el socio elige en Pagos antes de pagar (#479). La
 * condición va en la misma escritura para que un webhook que llega entre
 * la lectura y el `update` no deje cambiar el plan de una suscripción. */
export function createPlanChoiceGateway(
  serviceClient: SupabaseClient,
): PlanChoiceGateway {
  return {
    async savePlanChoice(userId, plan) {
      const now = new Date();
      const { data, error } = await serviceClient
        .from(MEMBERSHIPS_TABLE)
        .update({ plan, updated_at: now.toISOString() })
        .eq("user_id", userId)
        .is("stripe_subscription_id", null)
        .or(planChoiceStatusFilter(now))
        .select("user_id");
      if (error) {
        throw new Error(
          `No se pudo guardar el plan elegido por ${userId}: ${error.message}`,
        );
      }
      return data.length > 0;
    },
  };
}

/** Guarda o borra el cambio de plan programado (#456). Lo escribe Pagos
 * después de que Stripe lo aceptó; el webhook lo borra al aplicarse. */
export function createScheduledPlanChangeGateway(
  serviceClient: SupabaseClient,
): ScheduledPlanChangeGateway {
  return {
    async saveScheduledChange(userId, change) {
      const { error } = await serviceClient
        .from(MEMBERSHIPS_TABLE)
        .update({
          scheduled_plan: change === null ? null : change.plan,
          scheduled_at:
            change === null ? null : change.effectiveAt.toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("user_id", userId);
      if (error) {
        throw new Error(
          `No se pudo guardar el cambio de plan de ${userId}: ${error.message}`,
        );
      }
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
