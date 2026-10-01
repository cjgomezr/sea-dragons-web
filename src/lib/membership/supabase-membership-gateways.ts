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
  type MembershipWaiver,
} from "./membership";

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
