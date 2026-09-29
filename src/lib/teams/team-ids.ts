import type { EventType } from "@/lib/events/event-creation";

/**
 * Los dos equipos de un reparto y su modo (E10), sin nada de servidor detrás:
 * los usan el dominio del builder (#401) y la pantalla de Equipos (#402),
 * que va en el bundle del navegador.
 */

/** Sólo los entrenamientos y las competiciones se arman (D2). La agenda
 * tampoco le pide equipos a los demás (#403). */
export const BUILDABLE_EVENT_TYPES: readonly EventType[] = [
  "training",
  "competition",
];

export const TEAM_IDS = ["a", "b"] as const;

export type TeamId = (typeof TEAM_IDS)[number];

export const TEAM_SPLIT_MODES = ["manual", "auto"] as const;

export type TeamSplitMode = (typeof TEAM_SPLIT_MODES)[number];

export type TeamLabel = { readonly name: string; readonly color: string };

export type TeamLabels = { readonly [Team in TeamId]: TeamLabel };

export type TeamAssignment = {
  readonly userId: string;
  readonly team: TeamId;
};
