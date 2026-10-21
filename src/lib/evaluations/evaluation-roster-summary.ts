import { compareNames } from "@/lib/text/name-order";
import type {
  RosterEvaluationRecord,
  RosterMemberRecord,
  RosterRatingRecord,
} from "./evaluation-roster";
import { averageToOneDecimal, calculateOverallRating } from "./overall-rating";

/**
 * El resumen de la plantilla (#817, D5 del PRD de E31): lo calcula el
 * servidor con la misma lectura de la lista, porque el cliente no tiene la
 * categoría de cada nota. Recibe ya sólo a los jugadores de la lista: los
 * dados de baja no cuentan.
 */

/** Los que enseña "Más tiempo sin revisar" en el panel (RF-3). */
const LONGEST_UNREVIEWED_COUNT = 3;

export type CategoryAverage = {
  readonly categoryId: string;
  readonly name: string;
  readonly average: number;
};

export type UnreviewedPlayer = {
  readonly userId: string;
  readonly fullName: string;
  readonly updatedAt: string;
};

export type EvaluationRosterSummary = {
  readonly evaluatedCount: number;
  readonly playerCount: number;
  /** Sólo las categorías activas que alguien tiene, en el orden del club. */
  readonly categoryAverages: readonly CategoryAverage[];
  /** `null` sin ningún OVR: un cero sería una nota que nadie puso. */
  readonly averageOverall: number | null;
  /** Del más viejo al más nuevo. */
  readonly longestUnreviewed: readonly UnreviewedPlayer[];
};

type EvaluatedRecord = RosterMemberRecord & {
  readonly evaluation: RosterEvaluationRecord;
};

function isEvaluated(record: RosterMemberRecord): record is EvaluatedRecord {
  return record.evaluation !== null;
}

function compareCatalogOrder(
  first: RosterRatingRecord,
  second: RosterRatingRecord,
): number {
  return (
    first.sortOrder - second.sortOrder ||
    first.categoryName.localeCompare(second.categoryName)
  );
}

type CategoryRatings = {
  readonly category: RosterRatingRecord;
  readonly ratings: readonly number[];
};

/** Las notas de cada categoría activa, entre quienes la tienen. */
function groupActiveRatings(
  evaluated: readonly EvaluatedRecord[],
): readonly CategoryRatings[] {
  const groups = new Map<string, CategoryRatings>();
  for (const entry of evaluated.flatMap(
    (record) => record.evaluation.ratings,
  )) {
    if (entry.isRetired) {
      continue;
    }
    const group = groups.get(entry.categoryId);
    groups.set(
      entry.categoryId,
      group === undefined
        ? { category: entry, ratings: [entry.rating] }
        : { ...group, ratings: [...group.ratings, entry.rating] },
    );
  }
  return [...groups.values()];
}

/** Una categoría que nadie tiene no sale: no hay media que enseñar. */
function averageActiveCategories(
  evaluated: readonly EvaluatedRecord[],
): readonly CategoryAverage[] {
  return [...groupActiveRatings(evaluated)]
    .sort((first, second) =>
      compareCatalogOrder(first.category, second.category),
    )
    .flatMap(({ category, ratings }) => {
      const average = averageToOneDecimal(ratings);
      return average === null
        ? []
        : [
            {
              categoryId: category.categoryId,
              name: category.categoryName,
              average,
            },
          ];
    });
}

function averageOverallOf(
  evaluated: readonly EvaluatedRecord[],
): number | null {
  const overalls = evaluated.flatMap((record) => {
    const overall = calculateOverallRating(
      record.evaluation.ratings.map(({ rating }) => rating),
    );
    return overall === null ? [] : [overall];
  });
  return averageToOneDecimal(overalls);
}

function longestUnreviewedOf(
  evaluated: readonly EvaluatedRecord[],
): readonly UnreviewedPlayer[] {
  return [...evaluated]
    .sort(
      (first, second) =>
        Date.parse(first.evaluation.updatedAt) -
          Date.parse(second.evaluation.updatedAt) ||
        compareNames(first.fullName, second.fullName),
    )
    .slice(0, LONGEST_UNREVIEWED_COUNT)
    .map(({ userId, fullName, evaluation }) => ({
      userId,
      fullName,
      updatedAt: evaluation.updatedAt,
    }));
}

export function summarizeEvaluationRoster(
  records: readonly RosterMemberRecord[],
): EvaluationRosterSummary {
  const evaluated = records.filter(isEvaluated);
  return {
    evaluatedCount: evaluated.length,
    playerCount: records.length,
    categoryAverages: averageActiveCategories(evaluated),
    averageOverall: averageOverallOf(evaluated),
    longestUnreviewed: longestUnreviewedOf(evaluated),
  };
}
