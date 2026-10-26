"use client";

import { useId, useState } from "react";
import { Archive } from "@phosphor-icons/react/dist/ssr/Archive";
import { CaretRight } from "@phosphor-icons/react/dist/ssr/CaretRight";
import { DotsSixVertical } from "@phosphor-icons/react/dist/ssr/DotsSixVertical";
import { PencilSimple } from "@phosphor-icons/react/dist/ssr/PencilSimple";
import {
  type ClubPosition,
  positionName,
  positionShortName,
} from "@/lib/club/club-positions";
import { type Locale, otherLocale } from "@/lib/i18n/locale";
import type { Translator } from "@/lib/i18n/translator";
import { type SortableRowBinding, useSortableRow } from "./SortableRows";

/**
 * Las filas de la tabla de posiciones (#723, RF-5 del PRD de E26). Una activa
 * tiene su asa, su número, sus nombres con su abreviatura, su mínimo por
 * equipo (#887) y sus acciones; una archivada, sólo su nombre y Reactivar:
 * su mínimo no cuenta mientras lo esté (D9 del PRD de E34).
 *
 * El asa reordena con ↑ y ↓, o arrastrándola con ratón o dedo (#725). Las
 * archivadas van plegadas debajo de la tabla.
 */

export type Direction = "up" | "down";

/** Lo que marca un control para que la sección le devuelva el foco después
 * de pintar la lista nueva: al esperar la respuesta estaba desactivado y lo
 * perdió. */
export const FOCUS_KEY_ATTRIBUTE = "data-focus-key";

const DIRECTION_OF_KEY: Readonly<Record<string, Direction>> = {
  ArrowUp: "up",
  ArrowDown: "down",
};

export function handleFocusKey(positionId: string): string {
  return `${positionId}:handle`;
}

export function renameFocusKey(positionId: string): string {
  return `${positionId}:rename`;
}

/** El idioma al que le falta el nombre, empezando por el de la pantalla, o
 * `null` si tiene los dos. */
export function missingNameLocale(
  position: ClubPosition,
  locale: Locale,
): Locale | null {
  const other = otherLocale(locale);
  if (position.names[locale] === null) {
    return locale;
  }
  return position.names[other] === null ? other : null;
}

export function describeMissingName(
  translate: Translator,
  missing: Locale,
): string {
  return translate("clubSettings.positions.missingName", {
    language: translate(`clubSettings.positions.language.${missing}`),
  });
}

/** El nombre en el otro idioma ("ES · Portero"), o el aviso de que a uno le
 * falta. */
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
  const otherName = position.names[other];
  if (position.names[locale] !== null && otherName !== null) {
    return (
      <span className="club-positions-note">
        {translate("clubSettings.positions.otherName", {
          language: translate(`clubSettings.positions.languageCode.${other}`),
          name: otherName,
        })}
      </span>
    );
  }
  return (
    <span className="club-positions-note club-positions-note-missing">
      {describeMissingName(
        translate,
        position.names[locale] === null ? locale : other,
      )}
    </span>
  );
}

/** La de las fichas de los equipos; si el club no puso ninguna, la que se
 * usará, apagada. */
function ShortName({
  locale,
  position,
}: {
  locale: Locale;
  position: ClubPosition;
}): React.JSX.Element {
  const shortName = positionShortName(position, locale);
  return (
    <span
      className={
        shortName.isDefault
          ? "club-positions-short club-positions-short-default"
          : "club-positions-short"
      }
    >
      {shortName.text}
    </span>
  );
}

function NamesCell({
  translate,
  locale,
  position,
}: {
  translate: Translator;
  locale: Locale;
  position: ClubPosition;
}): React.JSX.Element {
  return (
    <div className="club-positions-cell club-positions-names">
      <span className="club-positions-name">
        {positionName(position.names, locale)}
      </span>
      <ShortName locale={locale} position={position} />
      <OtherLanguageNote
        translate={translate}
        locale={locale}
        position={position}
      />
    </div>
  );
}

export function ReorderHandle({
  translate,
  positionId,
  name,
  rank,
  total,
  hintId,
  setHandleNode,
  handleListeners,
  onMove,
}: {
  translate: Translator;
  positionId: string;
  name: string;
  rank: number;
  total: number;
  hintId: string;
  setHandleNode: SortableRowBinding["setHandleNode"];
  handleListeners: SortableRowBinding["handleListeners"];
  onMove: (direction: Direction) => void;
}): React.JSX.Element {
  function handleKey(event: React.KeyboardEvent): void {
    const direction = DIRECTION_OF_KEY[event.key];
    if (direction === undefined) {
      return;
    }
    // Las flechas no mueven la página mientras el asa tiene el foco.
    event.preventDefault();
    const isAtEdge = direction === "up" ? rank === 1 : rank === total;
    if (!isAtEdge) {
      onMove(direction);
    }
  }

  return (
    <div className="club-positions-cell">
      <button
        ref={setHandleNode}
        type="button"
        className="club-positions-handle"
        data-focus-key={handleFocusKey(positionId)}
        aria-label={translate("clubSettings.positions.handle.label", {
          name,
          rank,
          total,
        })}
        aria-describedby={hintId}
        {...handleListeners}
        onKeyDown={handleKey}
      >
        <DotsSixVertical aria-hidden="true" />
      </button>
    </div>
  );
}

function RowActions({
  translate,
  positionId,
  name,
  isBusy,
  onRename,
  onArchive,
}: {
  translate: Translator;
  positionId: string;
  name: string;
  isBusy: boolean;
  onRename: () => void;
  onArchive: () => void;
}): React.JSX.Element {
  return (
    <div className="club-positions-cell club-positions-actions">
      <button
        type="button"
        className="club-positions-icon-button"
        data-focus-key={renameFocusKey(positionId)}
        aria-label={translate("clubSettings.positions.rename.label", { name })}
        disabled={isBusy}
        onClick={onRename}
      >
        <PencilSimple aria-hidden="true" />
      </button>
      <button
        type="button"
        className="club-positions-icon-button"
        aria-label={translate("clubSettings.positions.archive.label", {
          name,
        })}
        disabled={isBusy}
        onClick={onArchive}
      >
        <Archive aria-hidden="true" />
      </button>
    </div>
  );
}

export function ActivePositionRow({
  translate,
  locale,
  position,
  rank,
  total,
  handleHintId,
  isBusy,
  minimumControl,
  renameForm,
  onMove,
  onRename,
  onArchive,
}: {
  translate: Translator;
  locale: Locale;
  position: ClubPosition;
  /** Empieza en 1. */
  rank: number;
  total: number;
  /** El texto que explica cómo se mueve con el asa. */
  handleHintId: string;
  isBusy: boolean;
  minimumControl: React.ReactNode;
  /** El formulario de renombrar, que ocupa el resto de la fila mientras está
   * abierto. */
  renameForm: React.ReactNode | null;
  onMove: (direction: Direction) => void;
  onRename: () => void;
  onArchive: () => void;
}): React.JSX.Element {
  const name = positionName(position.names, locale);
  const { setRowNode, rowClassName, rowStyle, setHandleNode, handleListeners } =
    useSortableRow(position.id);
  return (
    <li
      ref={setRowNode}
      className={`club-positions-row ${rowClassName}`.trimEnd()}
      style={rowStyle}
    >
      <ReorderHandle
        translate={translate}
        positionId={position.id}
        name={name}
        rank={rank}
        total={total}
        hintId={handleHintId}
        setHandleNode={setHandleNode}
        handleListeners={handleListeners}
        onMove={onMove}
      />
      <span className="club-positions-cell club-positions-rank">{rank}</span>
      {renameForm ?? (
        <>
          <NamesCell
            translate={translate}
            locale={locale}
            position={position}
          />
          {minimumControl}
          <RowActions
            translate={translate}
            positionId={position.id}
            name={name}
            isBusy={isBusy}
            onRename={onRename}
            onArchive={onArchive}
          />
        </>
      )}
    </li>
  );
}

function ArchivedPositionRow({
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
  const name = positionName(position.names, locale);
  return (
    <li className="club-positions-archived-row">
      <span className="club-positions-name">{name}</span>
      <button
        type="button"
        className="admin-secondary"
        aria-label={translate("clubSettings.positions.reactivate.label", {
          name,
        })}
        disabled={isBusy}
        onClick={onReactivate}
      >
        {translate("clubSettings.positions.reactivate")}
      </button>
    </li>
  );
}

/** Las archivadas, plegadas bajo la tabla: salen sólo si hay alguna. */
export function ArchivedPositions({
  translate,
  locale,
  archived,
  isBusy,
  onReactivate,
}: {
  translate: Translator;
  locale: Locale;
  archived: readonly ClubPosition[];
  isBusy: boolean;
  onReactivate: (position: ClubPosition) => void;
}): React.JSX.Element | null {
  const [isOpen, setIsOpen] = useState(false);
  const listId = useId();
  if (archived.length === 0) {
    return null;
  }
  return (
    <div className="club-positions-archived">
      <button
        type="button"
        className="club-positions-archived-toggle"
        aria-expanded={isOpen}
        aria-controls={listId}
        aria-label={translate("clubSettings.positions.archived.toggle.label", {
          total: archived.length,
        })}
        onClick={() => setIsOpen((current) => !current)}
      >
        <CaretRight
          className="club-positions-archived-caret"
          aria-hidden="true"
        />
        <span className="club-positions-archived-count">
          {translate("clubSettings.positions.archived.toggle", {
            total: archived.length,
          })}
        </span>
        <span className="club-positions-note">
          {translate("clubSettings.positions.archived.note")}
        </span>
      </button>
      {isOpen ? (
        <ul
          id={listId}
          className="club-positions-archived-list"
          aria-label={translate("clubSettings.positions.archived.title")}
        >
          {archived.map((position) => (
            <ArchivedPositionRow
              key={position.id}
              translate={translate}
              locale={locale}
              position={position}
              isBusy={isBusy}
              onReactivate={() => onReactivate(position)}
            />
          ))}
        </ul>
      ) : null}
    </div>
  );
}
