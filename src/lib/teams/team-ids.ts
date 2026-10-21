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

/** El límite de `clubs_team_a_name_length` en `0077_club_team_labels.sql`.
 * Vive aquí y no en `club-team-labels.ts` porque también lo usa el campo
 * Nombre de la pantalla (#760). */
export const CLUB_TEAM_NAME_MAX_LENGTH = 24;

export type TeamLabel = { readonly name: string; readonly color: string };

export type TeamLabels = { readonly [Team in TeamId]: TeamLabel };

export type TeamAssignment = {
  readonly userId: string;
  readonly team: TeamId;
};

/** Qué pasó con el reparto del evento desde cuyo builder se cambiaron los
 * equipos del club (D4 de E28): `relabelled` si estaba guardado sin publicar
 * y ya los lleva, `published` si estaba publicado y conserva los suyos,
 * `none` si no hay evento del club o no tiene reparto guardado. Vive aquí
 * porque también lo lee la pantalla. */
export const EVENT_SPLIT_LABELS = ["relabelled", "published", "none"] as const;

export type EventSplitLabels = (typeof EVENT_SPLIT_LABELS)[number];
