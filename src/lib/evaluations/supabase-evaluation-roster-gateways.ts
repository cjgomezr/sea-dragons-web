import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { ACCOUNT_STATUSES } from "@/lib/auth/account-status";
import { createRoleRequestGateways } from "@/lib/auth/supabase-role-request-gateways";
import type { NamedPosition } from "@/lib/club/club-positions";
import { toPositionNames } from "@/lib/club/supabase-club-positions";
import { signProfilePhotoUrls } from "@/lib/members/supabase-profile-photo-gateways";
import { readSupabaseServiceRoleConfig } from "@/lib/supabase/config";
import { createServiceRoleClient } from "@/lib/supabase/service-client";
import type {
  EvaluationRosterGateways,
  RosterEvaluationRecord,
  RosterMemberRecord,
} from "./evaluation-roster";

/**
 * Adaptador entre la lista de Evaluaciones (#322, #817) y Supabase.
 *
 * Va por la llave de servicio por el mismo motivo que la evaluación de un
 * miembro: `authenticated` no tiene ningún privilegio sobre las evaluaciones
 * (FR-055). El servidor ya comprobó que quien pide es Admin o Coach, y la
 * consulta va acotada a su club.
 *
 * Una sola consulta con la posición, la evaluación, quién la editó y cada
 * nota con su categoría anidadas: el PRD de E9 pide servir el club entero sin
 * una lectura por miembro, y el resumen de D5 (E31) sale de esa misma.
 */

type Environment = Readonly<Record<string, string | undefined>>;

const MEMBERS_TABLE = "members";

// Desde `0078` hay dos claves de `member_evaluations` a `members`: la del
// evaluado y la de quien editó. PostgREST no elige solo entre las dos, así
// que cada lado dice cuál sigue.
const ROSTER_COLUMNS = [
  "user_id, full_name, account_status, photo_path",
  "position:club_positions!members_position_same_club_fkey(id, names:club_position_names(locale, name))",
  "evaluations:member_evaluations!member_evaluations_member_same_club_fkey(updated_at, evaluator:members!member_evaluations_updated_by_same_club_fkey(full_name), member_evaluation_ratings(rating, evaluation_categories(id, name, sort_order, deactivated_at)))",
].join(", ");

const positionSchema = z.object({
  id: z.uuid(),
  names: z.array(z.object({ locale: z.string(), name: z.string() })),
});

const evaluationSchema = z.object({
  updated_at: z.string(),
  evaluator: z.object({ full_name: z.string() }).nullable(),
  member_evaluation_ratings: z.array(
    z.object({
      rating: z.number(),
      evaluation_categories: z.object({
        id: z.uuid(),
        name: z.string(),
        sort_order: z.number(),
        deactivated_at: z.string().nullable(),
      }),
    }),
  ),
});

// PostgREST sirve la evaluación como lista: la clave foránea es compuesta y
// la restricción única es sólo de `user_id`, así que no la ve como uno a uno.
// Una restricción única ya garantiza que haya como mucho una.
const rosterRowSchema = z.object({
  user_id: z.uuid(),
  full_name: z.string(),
  account_status: z.enum(ACCOUNT_STATUSES),
  photo_path: z.string().nullable(),
  position: positionSchema.nullable(),
  evaluations: z.array(evaluationSchema).max(1),
});

type RosterRow = z.infer<typeof rosterRowSchema>;

function toPosition(
  row: z.infer<typeof positionSchema> | null,
): NamedPosition | null {
  return row === null ? null : { id: row.id, names: toPositionNames(row) };
}

function toEvaluationRecord(
  row: z.infer<typeof evaluationSchema>,
): RosterEvaluationRecord {
  return {
    updatedAt: row.updated_at,
    updatedBy: row.evaluator === null ? null : row.evaluator.full_name,
    ratings: row.member_evaluation_ratings.map(
      ({ rating, evaluation_categories: category }) => ({
        categoryId: category.id,
        categoryName: category.name,
        sortOrder: category.sort_order,
        isRetired: category.deactivated_at !== null,
        rating,
      }),
    ),
  };
}

function toRosterMemberRecord(row: RosterRow): RosterMemberRecord {
  const [evaluation] = row.evaluations;
  return {
    userId: row.user_id,
    fullName: row.full_name,
    status: row.account_status,
    position: toPosition(row.position),
    photoPath: row.photo_path,
    evaluation:
      evaluation === undefined ? null : toEvaluationRecord(evaluation),
  };
}

async function findRosterMembers(
  serviceClient: SupabaseClient,
  clubId: string,
): Promise<readonly RosterMemberRecord[]> {
  const { data, error } = await serviceClient
    .from(MEMBERS_TABLE)
    .select(ROSTER_COLUMNS)
    .eq("club_id", clubId);
  if (error) {
    throw new Error(
      `No se pudo leer la lista de evaluaciones del club ${clubId}: ${error.message}`,
    );
  }
  const parsed = z.array(rosterRowSchema).safeParse(data);
  if (!parsed.success) {
    throw new Error(
      `La lista de evaluaciones del club ${clubId} volvió con una forma que el dominio no reconoce: ${parsed.error.message}`,
    );
  }
  return parsed.data.map(toRosterMemberRecord);
}

export function createEvaluationRosterGateways(
  serviceClient: SupabaseClient,
): EvaluationRosterGateways {
  return {
    members: createRoleRequestGateways(serviceClient).members,
    roster: {
      findRosterMembers: (clubId) => findRosterMembers(serviceClient, clubId),
    },
    photos: {
      signPhotoUrls: (photoPaths) =>
        signProfilePhotoUrls(serviceClient, photoPaths),
    },
  };
}

export type EvaluationRosterGatewaysResult =
  | { readonly kind: "ready"; readonly gateways: EvaluationRosterGateways }
  | { readonly kind: "unconfigured"; readonly missingKeys: readonly string[] };

/** Raíz de composición del endpoint. Devuelve las variables que faltan en vez
 * de lanzar, como las demás. */
export function createSupabaseEvaluationRosterGateways(
  env: Environment,
): EvaluationRosterGatewaysResult {
  const config = readSupabaseServiceRoleConfig(env);
  if (config.kind === "missing") {
    return { kind: "unconfigured", missingKeys: config.missingKeys };
  }
  return {
    kind: "ready",
    gateways: createEvaluationRosterGateways(createServiceRoleClient(env)),
  };
}
