"use client";

import { type ClubPosition, positionName } from "@/lib/club/club-positions";
import { type Locale, otherLocale } from "@/lib/i18n/locale";
import type { Translator } from "@/lib/i18n/translator";

/**
 * Una posición en la sección de posiciones de la configuración (#300): su
 * nombre en el idioma de la pantalla, el del otro idioma debajo y sus
 * acciones. Las activas se mueven, renombran y archivan; las archivadas sólo
 * se reactivan.
 */

export type Direction = "up" | "down";

/** Lo que marca un botón para que la sección le devuelva el foco después
 * de pintar la lista nueva: al esperar la respuesta estaba desactivado y lo
 * perdió. */
export const FOCUS_KEY_ATTRIBUTE = "data-focus-key";

export function moveFocusKey(positionId: string, direction: Direction): string {
  return `${positionId}:${direction}`;
}

export function renameFocusKey(positionId: string): string {
  return `${positionId}:rename`;
}

/** El nombre en el otro idioma, o el aviso de que a uno le falta y se ve el
 * que hay. */
function OtherLanguageNote({
  translate,
  locale,
  position,
}: {
  translate: Translator;
  locale: Locale;
  position: ClubPosition;
}): React.JSX.Element {
  const other = otherLocale(locale);
  const ownName = position.names[locale];
  const otherName = position.names[other];
  if (ownName !== null && otherName !== null) {
    return (
      <p className="club-positions-note">
        {translate("clubSettings.positions.otherName", {
          language: translate(`clubSettings.positions.language.${other}`),
          name: otherName,
        })}
      </p>
    );
  }
  const missing = ownName === null ? locale : other;
  return (
    <p className="club-positions-note">
      {translate("clubSettings.positions.missingName", {
        language: translate(`clubSettings.positions.language.${missing}`),
      })}
    </p>
  );
}

function PositionHeading({
  translate,
  locale,
  position,
  rank,
}: {
  translate: Translator;
  locale: Locale;
  position: ClubPosition;
  /** El puesto en el orden, sólo en las activas. */
  rank?: number;
}): React.JSX.Element {
  return (
    <div className="club-positions-head">
      {rank === undefined ? null : (
        <span className="club-positions-rank" aria-hidden="true">
          {rank}
        </span>
      )}
      <div className="club-positions-names">
        <h4 className="club-positions-name">
          {positionName(position.names, locale)}
        </h4>
        <OtherLanguageNote
          translate={translate}
          locale={locale}
          position={position}
        />
      </div>
    </div>
  );
}

export function ActivePositionItem({
  translate,
  locale,
  position,
  rank,
  total,
  isBusy,
  isEditing,
  onMove,
  onToggleRename,
  onArchive,
  children,
}: {
  translate: Translator;
  locale: Locale;
  position: ClubPosition;
  /** Empieza en 1. */
  rank: number;
  total: number;
  isBusy: boolean;
  isEditing: boolean;
  onMove: (direction: Direction) => void;
  onToggleRename: () => void;
  onArchive: () => void;
  /** El formulario de renombrar, cuando está abierto. */
  children?: React.ReactNode;
}): React.JSX.Element {
  const name = positionName(position.names, locale);
  const isAtEdge = (direction: Direction): boolean =>
    direction === "up" ? rank === 1 : rank === total;
  const moveButton = (direction: Direction): React.JSX.Element => (
    <button
      type="button"
      className="admin-secondary"
      data-focus-key={moveFocusKey(position.id, direction)}
      aria-label={translate(`clubSettings.positions.move.${direction}.label`, {
        name,
      })}
      disabled={isBusy || isAtEdge(direction)}
      onClick={() => onMove(direction)}
    >
      {translate(`clubSettings.positions.move.${direction}`)}
    </button>
  );
  return (
    <li className="groups-item club-positions-item">
      <PositionHeading
        translate={translate}
        locale={locale}
        position={position}
        rank={rank}
      />
      <div className="groups-actions">
        {moveButton("up")}
        {moveButton("down")}
        <button
          type="button"
          className="admin-secondary"
          data-focus-key={renameFocusKey(position.id)}
          aria-label={translate("clubSettings.positions.rename.label", {
            name,
          })}
          aria-expanded={isEditing}
          disabled={isBusy}
          onClick={onToggleRename}
        >
          {translate("clubSettings.positions.rename")}
        </button>
        <button
          type="button"
          className="admin-secondary"
          aria-label={translate("clubSettings.positions.archive.label", {
            name,
          })}
          disabled={isBusy}
          onClick={onArchive}
        >
          {translate("clubSettings.positions.archive")}
        </button>
      </div>
      {children}
    </li>
  );
}

export function ArchivedPositionItem({
  translate,
  locale,
  position,
  isBusy,
  onReactivate,
}: {
  translate: Translator;
  locale: Locale;
  position: ClubPosition;
  isBusy: boolean;
  onReactivate: () => void;
}): React.JSX.Element {
  return (
    <li className="groups-item club-positions-item">
      <PositionHeading
        translate={translate}
        locale={locale}
        position={position}
      />
      <div className="groups-actions">
        <button
          type="button"
          className="admin-secondary"
          aria-label={translate("clubSettings.positions.reactivate.label", {
            name: positionName(position.names, locale),
          })}
          disabled={isBusy}
          onClick={onReactivate}
        >
          {translate("clubSettings.positions.reactivate")}
        </button>
      </div>
    </li>
  );
}
