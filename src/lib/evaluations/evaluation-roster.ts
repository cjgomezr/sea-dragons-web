import type { AccountStatus } from "@/lib/auth/account-status";
import type { NamedPosition } from "@/lib/club/club-positions";
import { compareNames } from "@/lib/text/name-order";
import {
  type EvaluationRosterSummary,
  summarizeEvaluationRoster,
} from "./evaluation-roster-summary";
import {
  type MemberEvaluationGateways,
  findEvaluatorActor,
} from "./member-evaluation";
import { calculateOverallRating } from "./overall-rating";

/**
 * La lista de la pantalla de Evaluaciones (#322, RF-6 del PRD de E9): los
 * miembros del club con su OVR, y quién está sin evaluar. Desde #817 (RF-1 del
 * PRD de E31) trae también la posición, la foto, cuándo y quién hizo la
 * última edición, y el resumen de la plantilla. Contada sin Supabase delante.
 *
 * Sólo la ve el personal de entrenamiento (FR-055), igual que cada
 * evaluación. Los dados de baja no salen: no se les puede evaluar, y el PRD
 * los deja al directorio con los inactivos.
 */

const INACTIVE_STATUS: AccountStatus = "inactive";

/** Una nota con su categoría, para la media por categoría del resumen.
 * `isRetired` es que el club la desactivó después. */
export type RosterRatingRecord = {
  readonly categoryId: string;
  readonly categoryName: string;
  readonly sortOrder: number;
  readonly isRetired: boolean;
  readonly rating: number;
};

/** `updatedBy` es el nombre de quien hizo la última edición; `null` si es
 * de antes de `0078` o si esa persona ya no está en el club. */
export type RosterEvaluationRecord = {
  readonly updatedAt: string;
  readonly updatedBy: string | null;
  readonly ratings: readonly RosterRatingRecord[];
};

/** Un miembro tal como llega de la base. `evaluation` en `null` es que no
 * tiene evaluación; una lista de notas vacía es una evaluación sin
 * categorías. */
export type RosterMemberRecord = {
  readonly userId: string;
  readonly fullName: string;
  readonly status: AccountStatus;
  readonly position: NamedPosition | null;
  readonly photoPath: string | null;
  readonly evaluation: RosterEvaluationRecord | null;
};

type RosterPlayer = {
  readonly userId: string;
  readonly fullName: string;
  /** Con sus nombres en cada idioma, como en el directorio: la pinta quien
   * sabe en qué idioma está la pantalla. */
  readonly position: NamedPosition | null;
  /** Null sin foto: la fila enseña entonces las iniciales. */
  readonly photoUrl: string | null;
};

export type EvaluationRosterEntry =
  | (RosterPlayer & { readonly status: "not_evaluated" })
  | (RosterPlayer & {
      readonly status: "evaluated";
      /** El OVR de D3; `null` sin ninguna categoría: no hay media de nada. */
      readonly overall: number | null;
      readonly updatedAt: string;
      readonly updatedBy: string | null;
    });

export type EvaluationRoster = {
  readonly members: readonly EvaluationRosterEntry[];
  readonly summary: EvaluationRosterSummary;
};

export type EvaluationRosterGateways = Pick<
  MemberEvaluationGateways,
  "members"
> & {
  readonly roster: {
    /** Todos los miembros del club con su evaluación, en una consulta
     * (PRD de E9, rendimiento, y D5 del de E31: nada de una por miembro). */
    findRosterMembers(clubId: string): Promise<readonly RosterMemberRecord[]>;
  };
  readonly photos: {
    /** Las miniaturas firmadas, por ruta. La que no se firma no está. */
    signPhotoUrls(
      photoPaths: readonly string[],
    ): Promise<ReadonlyMap<string, string>>;
  };
};

/** Una foto que no se firma deja las iniciales, como en el team builder: no
 * tumba la lista. El fallo queda registrado con su motivo. */
async function signPhotosOrNone(
  gateways: Pick<EvaluationRosterGateways, "photos">,
  records: readonly RosterMemberRecord[],
): Promise<ReadonlyMap<string, string>> {
  const photoPaths = records.flatMap((record) =>
    record.photoPath === null ? [] : [record.photoPath],
  );
  if (photoPaths.length === 0) {
    return new Map();
  }
  try {
    return await gateways.photos.signPhotoUrls(photoPaths);
  } catch (error) {
    console.error(
      `[evaluations] no se pudieron firmar ${photoPaths.length} fotos; salen las iniciales: ${String(error)}`,
    );
    return new Map();
  }
}

function toRosterEntry(
  record: RosterMemberRecord,
  photoUrls: ReadonlyMap<string, string>,
): EvaluationRosterEntry {
  const { userId, fullName, position, photoPath, evaluation } = record;
  const player: RosterPlayer = {
    userId,
    fullName,
    position,
    photoUrl: photoPath === null ? null : (photoUrls.get(photoPath) ?? null),
  };
  if (evaluation === null) {
    return { status: "not_evaluated", ...player };
  }
  return {
    status: "evaluated",
    ...player,
    overall: calculateOverallRating(
      evaluation.ratings.map((entry) => entry.rating),
    ),
    updatedAt: evaluation.updatedAt,
    updatedBy: evaluation.updatedBy,
  };
}

export async function listEvaluationRoster(
  gateways: EvaluationRosterGateways,
  callerId: string,
): Promise<EvaluationRoster> {
  const actor = await findEvaluatorActor(gateways, callerId);
  const records = (await gateways.roster.findRosterMembers(actor.clubId))
    .filter((record) => record.status !== INACTIVE_STATUS)
    .sort((first, second) => compareNames(first.fullName, second.fullName));
  const photoUrls = await signPhotosOrNone(gateways, records);
  return {
    members: records.map((record) => toRosterEntry(record, photoUrls)),
    summary: summarizeEvaluationRoster(records),
  };
}
