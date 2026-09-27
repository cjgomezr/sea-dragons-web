import type { AccountStatus } from "@/lib/auth/account-status";
import { compareNames } from "@/lib/text/name-order";
import {
  type MemberEvaluationGateways,
  findEvaluatorActor,
} from "./member-evaluation";
import { calculateOverallRating } from "./overall-rating";

/**
 * La lista de la pantalla de Evaluaciones (#322, RF-6 del PRD de E9): los
 * miembros del club con su OVR, y quién está sin evaluar. Contada sin
 * Supabase delante.
 *
 * Sólo la ve el personal de entrenamiento (FR-055), igual que cada
 * evaluación. Los dados de baja no salen: no se les puede evaluar, y el PRD
 * los deja al directorio con los inactivos.
 */

const INACTIVE_STATUS: AccountStatus = "inactive";

/** Un miembro tal como llega de la base. `ratings` en `null` es que no tiene
 * evaluación; una lista vacía es una evaluación sin categorías. */
export type RosterMemberRecord = {
  readonly userId: string;
  readonly fullName: string;
  readonly status: AccountStatus;
  readonly ratings: readonly number[] | null;
};

export type EvaluationRosterEntry =
  | {
      readonly status: "not_evaluated";
      readonly userId: string;
      readonly fullName: string;
    }
  | {
      readonly status: "evaluated";
      readonly userId: string;
      readonly fullName: string;
      /** `null` sin ninguna categoría: no hay media de nada. */
      readonly overallRating: number | null;
    };

export type EvaluationRoster = {
  readonly members: readonly EvaluationRosterEntry[];
};

export type EvaluationRosterGateways = Pick<
  MemberEvaluationGateways,
  "members"
> & {
  readonly roster: {
    /** Todos los miembros del club con sus valoraciones, en una consulta
     * (PRD, rendimiento: nada de una por miembro). */
    findRosterMembers(clubId: string): Promise<readonly RosterMemberRecord[]>;
  };
};

function toRosterEntry(record: RosterMemberRecord): EvaluationRosterEntry {
  const { userId, fullName, ratings } = record;
  if (ratings === null) {
    return { status: "not_evaluated", userId, fullName };
  }
  return {
    status: "evaluated",
    userId,
    fullName,
    overallRating: calculateOverallRating(ratings),
  };
}

export async function listEvaluationRoster(
  gateways: EvaluationRosterGateways,
  callerId: string,
): Promise<EvaluationRoster> {
  const actor = await findEvaluatorActor(gateways, callerId);
  const records = await gateways.roster.findRosterMembers(actor.clubId);
  return {
    members: records
      .filter((record) => record.status !== INACTIVE_STATUS)
      .sort((first, second) => compareNames(first.fullName, second.fullName))
      .map(toRosterEntry),
  };
}
