import type { SquadPlayer, TeamSplit } from "@/lib/teams/squad";
import { suggestSwap, type SwapImprovement } from "@/lib/teams/swap-suggestion";
import {
  TEAM_IDS,
  type TeamAssignment,
  type TeamId,
  type TeamLabels,
  type TeamSplitMode,
} from "@/lib/teams/team-ids";
import {
  type SplitTotals,
  calculateSplitTotals,
} from "@/lib/teams/team-totals";
import type {
  BalancedSplit,
  OpenedBuilder,
  RosterEntry,
} from "./team-builder-client";

/**
 * El reparto que se está armando en la pantalla de Equipos (#402), en
 * memoria hasta guardar: quién está en cada equipo, de qué lista salió cada
 * jugador y lo último que el servidor tiene, para saber si hay cambios.
 *
 * Los totales y la sugerencia se calculan aquí con las mismas funciones que
 * usa el servidor (FR-045, FR-047): cambian al instante al mover (AC-018).
 */

/** De dónde sale un jugador y a dónde vuelve si se le quita del equipo. Un
 * asignado que ya no está en la escuadra no vuelve a ninguna lista. */
export type RosterOrigin = "available" | "maybe" | "outside";

export type RosterPlayer = RosterEntry & { readonly origin: RosterOrigin };

export type Destination = TeamId | "bench";

export type TeamDraft = {
  readonly teams: TeamLabels;
  readonly mode: TeamSplitMode;
  readonly roster: readonly RosterPlayer[];
  readonly assignments: readonly TeamAssignment[];
  /** Lo que el servidor tiene: lo que llegó al abrir o lo último guardado. */
  readonly saved: readonly TeamAssignment[];
  readonly publishedAt: string | null;
};

export type DraftSuggestion = {
  readonly fromA: RosterPlayer;
  readonly fromB: RosterPlayer;
  readonly improvement: SwapImprovement;
  readonly ratingDifferenceAfter: number;
};

function withOrigin(
  entries: readonly RosterEntry[],
  origin: RosterOrigin,
): RosterPlayer[] {
  return entries.map((entry) => ({ ...entry, origin }));
}

export function startDraft(builder: OpenedBuilder): TeamDraft {
  const assigned = builder.split?.assignments ?? [];
  const outside = assigned.filter((assignment) => assignment.isOutsideSquad);
  const assignments = assigned.map(({ userId, team }) => ({ userId, team }));
  return {
    teams: builder.teams,
    mode: builder.split?.mode ?? "manual",
    roster: [
      ...withOrigin(builder.available, "available"),
      ...withOrigin(builder.maybe, "maybe"),
      ...withOrigin(outside, "outside"),
    ],
    assignments,
    saved: assignments,
    publishedAt: builder.split?.publishedAt ?? null,
  };
}

export function findPlayer(draft: TeamDraft, userId: string): RosterPlayer {
  const player = draft.roster.find((entry) => entry.userId === userId);
  if (player === undefined) {
    throw new Error(`${userId} no está en la escuadra que se está armando.`);
  }
  return player;
}

export function teamOf(draft: TeamDraft, userId: string): TeamId | null {
  return (
    draft.assignments.find((assignment) => assignment.userId === userId)
      ?.team ?? null
  );
}

/** Mover a mano deja el reparto en modo manual (RF-5). */
export function movePlayer(
  draft: TeamDraft,
  userId: string,
  destination: Destination,
): TeamDraft {
  const others = draft.assignments.filter(
    (assignment) => assignment.userId !== userId,
  );
  return {
    ...draft,
    mode: "manual",
    assignments:
      destination === "bench"
        ? others
        : [...others, { userId, team: destination }],
  };
}

export function swapPlayers(
  draft: TeamDraft,
  fromA: string,
  fromB: string,
): TeamDraft {
  return movePlayer(movePlayer(draft, fromA, "b"), fromB, "a");
}

/** El auto-balance ya quedó guardado en el servidor: es la nueva referencia. */
export function applyBalance(
  draft: TeamDraft,
  balanced: BalancedSplit,
): TeamDraft {
  const assignments = TEAM_IDS.flatMap((team) =>
    balanced[team].map(({ userId }) => ({ userId, team })),
  );
  // El servidor reparte sólo los "Sí": quien falte en la escuadra abierta
  // respondió después, y si se le quita vuelve a los disponibles.
  const newcomers = [...balanced.a, ...balanced.b].filter(
    (entry) => !draft.roster.some((player) => player.userId === entry.userId),
  );
  return {
    ...draft,
    teams: balanced.teams,
    mode: "auto",
    roster: [...draft.roster, ...withOrigin(newcomers, "available")],
    assignments,
    saved: assignments,
  };
}

/** Lo que se mandó quedó guardado, y guardar a mano deja el modo manual. */
export function settleDraft(
  draft: TeamDraft,
  sent: readonly TeamAssignment[],
): TeamDraft {
  return { ...draft, mode: "manual", saved: sent };
}

function assignmentKeys(assignments: readonly TeamAssignment[]): string {
  return assignments
    .map(({ userId, team }) => `${userId}:${team}`)
    .sort()
    .join(",");
}

export function hasUnsavedChanges(draft: TeamDraft): boolean {
  return assignmentKeys(draft.assignments) !== assignmentKeys(draft.saved);
}

function byRatingThenName(first: RosterPlayer, second: RosterPlayer): number {
  return (
    second.rating - first.rating ||
    first.fullName.localeCompare(second.fullName)
  );
}

/** Los de un equipo, del OVR más alto al más bajo, como en el mockup. */
export function teamPlayers(draft: TeamDraft, team: TeamId): RosterPlayer[] {
  return draft.assignments
    .filter((assignment) => assignment.team === team)
    .map((assignment) => findPlayer(draft, assignment.userId))
    .sort(byRatingThenName);
}

/** Los de una lista sin asignar, en el orden en que los sirve la API. */
export function benchPlayers(
  draft: TeamDraft,
  origin: Exclude<RosterOrigin, "outside">,
): RosterPlayer[] {
  return draft.roster.filter(
    (player) =>
      player.origin === origin && teamOf(draft, player.userId) === null,
  );
}

function toSquadPlayer(player: RosterPlayer): SquadPlayer {
  return {
    userId: player.userId,
    fullName: player.fullName,
    rating: player.isUnrated ? null : player.rating,
    coverage: player.coverage,
  };
}

function splitOf(draft: TeamDraft): TeamSplit {
  return {
    a: teamPlayers(draft, "a").map(toSquadPlayer),
    b: teamPlayers(draft, "b").map(toSquadPlayer),
  };
}

export function draftTotals(draft: TeamDraft): SplitTotals {
  return calculateSplitTotals(splitOf(draft));
}

export function draftSuggestion(draft: TeamDraft): DraftSuggestion | null {
  const swap = suggestSwap(splitOf(draft));
  return swap === null
    ? null
    : {
        fromA: findPlayer(draft, swap.playerFromA.userId),
        fromB: findPlayer(draft, swap.playerFromB.userId),
        improvement: swap.improvement,
        ratingDifferenceAfter: swap.ratingDifferenceAfter,
      };
}
