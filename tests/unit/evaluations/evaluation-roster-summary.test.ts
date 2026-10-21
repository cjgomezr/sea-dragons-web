import { describe, expect, it } from "vitest";
import type {
  RosterMemberRecord,
  RosterRatingRecord,
} from "@/lib/evaluations/evaluation-roster";
import { summarizeEvaluationRoster } from "@/lib/evaluations/evaluation-roster-summary";

/**
 * El resumen de la plantilla (#817, D5 del PRD de E31): cuántos están
 * evaluados, la media de cada categoría activa, la media de los OVR y quién
 * lleva más tiempo sin revisar. Lo calcula el servidor con la misma lectura
 * de la lista.
 */

const FITNESS = {
  categoryId: "ca7e0000-0000-4000-8000-000000000001",
  categoryName: "Fitness",
  sortOrder: 1,
};
const SPEED = {
  categoryId: "ca7e0000-0000-4000-8000-000000000002",
  categoryName: "Speed",
  sortOrder: 2,
};
const TEAMWORK = {
  categoryId: "ca7e0000-0000-4000-8000-000000000003",
  categoryName: "Teamwork",
  sortOrder: 3,
};

function rated(
  category: typeof FITNESS,
  rating: number,
  isRetired = false,
): RosterRatingRecord {
  return { ...category, rating, isRetired };
}

function player(
  fullName: string,
  evaluation: {
    readonly updatedAt: string;
    readonly ratings: readonly RosterRatingRecord[];
  } | null,
): RosterMemberRecord {
  return {
    userId: `id-${fullName}`,
    fullName,
    status: "active",
    position: null,
    photoPath: null,
    evaluation:
      evaluation === null ? null : { ...evaluation, updatedBy: "Carla Coach" },
  };
}

describe("resumen de la plantilla", () => {
  it("cuenta los evaluados sobre el total de jugadores", () => {
    const records = [
      player("Ana", {
        updatedAt: "2026-10-01T00:00:00+00:00",
        ratings: [rated(FITNESS, 7)],
      }),
      player("Beto", null),
      player("Cora", null),
    ];

    const summary = summarizeEvaluationRoster(records);

    expect(summary.evaluatedCount).toBe(1);
    expect(summary.playerCount).toBe(3);
  });

  it("promedia cada categoría activa sólo entre quienes la tienen, a un decimal", () => {
    const records = [
      player("Ana", {
        updatedAt: "2026-10-01T00:00:00+00:00",
        ratings: [rated(FITNESS, 7), rated(SPEED, 8)],
      }),
      player("Beto", {
        updatedAt: "2026-10-02T00:00:00+00:00",
        ratings: [rated(FITNESS, 8)],
      }),
      player("Cora", {
        updatedAt: "2026-10-03T00:00:00+00:00",
        ratings: [rated(FITNESS, 8)],
      }),
      player("Dani", null),
    ];

    const summary = summarizeEvaluationRoster(records);

    expect(summary.categoryAverages).toEqual([
      { categoryId: FITNESS.categoryId, name: "Fitness", average: 7.7 },
      { categoryId: SPEED.categoryId, name: "Speed", average: 8 },
    ]);
  });

  it("deja fuera una categoría desactivada, aunque alguna evaluación la conserve", () => {
    const records = [
      player("Ana", {
        updatedAt: "2026-10-01T00:00:00+00:00",
        ratings: [rated(FITNESS, 6), rated(TEAMWORK, 10, true)],
      }),
    ];

    const summary = summarizeEvaluationRoster(records);

    expect(summary.categoryAverages).toEqual([
      { categoryId: FITNESS.categoryId, name: "Fitness", average: 6 },
    ]);
  });

  it("ordena las categorías como el catálogo del club", () => {
    const records = [
      player("Ana", {
        updatedAt: "2026-10-01T00:00:00+00:00",
        ratings: [rated(TEAMWORK, 5), rated(FITNESS, 6), rated(SPEED, 7)],
      }),
    ];

    const summary = summarizeEvaluationRoster(records);

    expect(summary.categoryAverages.map((entry) => entry.name)).toEqual([
      "Fitness",
      "Speed",
      "Teamwork",
    ]);
  });

  it("promedia los OVR de los evaluados, cada uno según D3", () => {
    const records = [
      // OVR 7.5: la media de sus dos categorías, contando la desactivada.
      player("Ana", {
        updatedAt: "2026-10-01T00:00:00+00:00",
        ratings: [rated(FITNESS, 7), rated(TEAMWORK, 8, true)],
      }),
      player("Beto", {
        updatedAt: "2026-10-02T00:00:00+00:00",
        ratings: [rated(FITNESS, 9)],
      }),
      // Sin categorías no tiene OVR, y no cuenta como un cero.
      player("Cora", { updatedAt: "2026-10-03T00:00:00+00:00", ratings: [] }),
      player("Dani", null),
    ];

    const summary = summarizeEvaluationRoster(records);

    expect(summary.averageOverall).toBe(8.3);
  });

  it("da los tres evaluados con la fecha más antigua, del más viejo al más nuevo", () => {
    const records = [
      player("Ana", { updatedAt: "2026-10-04T00:00:00+00:00", ratings: [] }),
      player("Beto", {
        updatedAt: "2026-09-01T09:30:00.123456+00:00",
        ratings: [],
      }),
      player("Cora", null),
      player("Dani", { updatedAt: "2026-10-02T00:00:00+00:00", ratings: [] }),
      player("Eva", { updatedAt: "2026-09-15T00:00:00+00:00", ratings: [] }),
    ];

    const summary = summarizeEvaluationRoster(records);

    expect(summary.longestUnreviewed).toEqual([
      {
        userId: "id-Beto",
        fullName: "Beto",
        updatedAt: "2026-09-01T09:30:00.123456+00:00",
      },
      {
        userId: "id-Eva",
        fullName: "Eva",
        updatedAt: "2026-09-15T00:00:00+00:00",
      },
      {
        userId: "id-Dani",
        fullName: "Dani",
        updatedAt: "2026-10-02T00:00:00+00:00",
      },
    ]);
  });

  it("desempata los más antiguos por nombre", () => {
    const sameDay = "2026-09-01T00:00:00+00:00";
    const records = [
      player("Zoe", { updatedAt: sameDay, ratings: [] }),
      player("Álvaro", { updatedAt: sameDay, ratings: [] }),
    ];

    const summary = summarizeEvaluationRoster(records);

    expect(summary.longestUnreviewed.map((entry) => entry.fullName)).toEqual([
      "Álvaro",
      "Zoe",
    ]);
  });

  it("con el club vacío trae ceros y listas vacías", () => {
    const summary = summarizeEvaluationRoster([]);

    expect(summary).toEqual({
      evaluatedCount: 0,
      playerCount: 0,
      categoryAverages: [],
      averageOverall: null,
      longestUnreviewed: [],
    });
  });

  it("sin categorías activas no trae ninguna media por categoría", () => {
    const records = [
      player("Ana", {
        updatedAt: "2026-10-01T00:00:00+00:00",
        ratings: [rated(FITNESS, 7, true)],
      }),
    ];

    const summary = summarizeEvaluationRoster(records);

    expect(summary.categoryAverages).toEqual([]);
    expect(summary.evaluatedCount).toBe(1);
  });
});
