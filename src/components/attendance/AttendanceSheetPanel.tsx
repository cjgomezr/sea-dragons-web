"use client";

import { ArrowRight } from "@phosphor-icons/react/dist/ssr/ArrowRight";
import { CheckCircle } from "@phosphor-icons/react/dist/ssr/CheckCircle";
import { FloppyDisk } from "@phosphor-icons/react/dist/ssr/FloppyDisk";
import Link from "next/link";
import { useState } from "react";
import { Icon } from "@/components/Icon";
import { useIsPhone } from "@/components/use-is-phone";
import {
  ATTENDANCE_STATUSES,
  type AttendanceTotals,
} from "@/lib/attendance/attendance-status";
import { CALENDAR_PATH } from "@/lib/auth/routes";
import type { RsvpResponse } from "@/lib/events/event-rsvp";
import type { Translator } from "@/lib/i18n/translator";
import { matchesNameSearch } from "@/lib/text/name-search";
import {
  type OpenedSheet,
  type SessionChoice,
  type SheetMember,
  describeAttendanceFailure,
} from "./attendance-client";
import {
  type SheetMarks,
  countUnsaved,
  isMemberUnsaved,
  statusOf,
  totalsOf,
} from "./attendance-marks";
import { AttendanceRow, type RowViewer, opensElsewhere } from "./AttendanceRow";
import { AttendanceSearch } from "./AttendanceSearch";
import { sessionDay } from "./session-day";
import {
  type AttendanceSheetControls,
  type SaveState,
  useAttendanceSheet,
} from "./use-attendance-sheet";

/**
 * La hoja de una sesión (#395), siguiendo docs/mockups/attendance-light.png:
 * el título con la fecha y el botón de guardar, las fichas de las sesiones
 * recientes, los tres contadores y la lista, agrupada por la respuesta al
 * RSVP (#412, D6) para que el Coach vea a quién le toca revisar.
 *
 * Desde E29 (#765) Guardar dice cuántos socios faltan por guardar, el aviso
 * de guardado es una franja teñida y los totales son un solo panel con una
 * barra apilada.
 *
 * En el móvil (#766) la cabecera no lleva Guardar: baja a una barra fija que
 * sólo sale mientras hay cambios (D5 de E29).
 *
 * El buscador por nombre sólo decide qué filas se ven: los totales, lo
 * marcado y lo que se guarda siguen siendo del grupo entero.
 *
 * Se monta de nuevo con cada sesión (la pantalla le pone su id como clave),
 * así lo marcado en una no se cuela en otra. Por eso las fichas viven aquí:
 * son las que saben si hay cambios que descartar antes de irse.
 */

type RsvpGroup = RsvpResponse | "none";

/** El orden de los grupos, el mismo en que el servidor ordena las filas. */
const RSVP_GROUPS: readonly RsvpGroup[] = ["yes", "maybe", "none", "no"];

function groupOf(member: SheetMember): RsvpGroup {
  return member.rsvpResponse ?? "none";
}

function sheetTitle(translate: Translator, sheet: OpenedSheet): string {
  const { weekday, day, month } = sessionDay(translate.locale, sheet.startsAt);
  return translate("attendance.title", {
    title: sheet.title,
    date: `${weekday} ${day} ${month}`,
  });
}

function SessionChips({
  translate,
  sessions,
  openedId,
  onChoose,
  canLeaveSheet,
}: {
  readonly translate: Translator;
  readonly sessions: readonly SessionChoice[];
  readonly openedId: string;
  readonly onChoose: (eventId: string) => void;
  readonly canLeaveSheet: () => boolean;
}): React.JSX.Element {
  return (
    <div
      className="attendance-sessions"
      role="group"
      aria-label={translate("attendance.sessions.label")}
    >
      {sessions.map((session) => {
        const { weekday, day } = sessionDay(translate.locale, session.startsAt);
        return (
          <button
            key={session.eventId}
            type="button"
            className="attendance-session"
            aria-pressed={session.eventId === openedId}
            onClick={() => onChoose(session.eventId)}
          >
            {translate("attendance.sessions.choice", {
              weekday,
              day,
              title: session.title,
            })}
          </button>
        );
      })}
      <OlderSessionsLink translate={translate} canLeaveSheet={canLeaveSheet} />
    </div>
  );
}

/** Las fichas sólo llegan a 30 días atrás (#580): una sesión más vieja se
 * abre desde el calendario, con "Pasar lista". En el móvil dice sólo
 * "Anteriores", que sigue dentro de su nombre accesible. */
function OlderSessionsLink({
  translate,
  canLeaveSheet,
}: {
  readonly translate: Translator;
  readonly canLeaveSheet: () => boolean;
}): React.JSX.Element {
  const isPhone = useIsPhone();
  return (
    <Link
      href={CALENDAR_PATH}
      className="attendance-older-sessions"
      aria-label={translate("attendance.olderSessions.label")}
      onClick={(event) => {
        if (!opensElsewhere(event) && !canLeaveSheet()) {
          event.preventDefault();
        }
      }}
    >
      {translate(
        isPhone ? "attendance.olderSessions.short" : "attendance.olderSessions",
      )}
      <Icon glyph={ArrowRight} />
    </Link>
  );
}

/** Los que vinieron: también cuenta quien llegó tarde. */
function cameCount(totals: AttendanceTotals): number {
  return totals.present + totals.late;
}

function totalCount(totals: AttendanceTotals): number {
  return totals.present + totals.late + totals.absent;
}

/** Decoración: los números ya van escritos en la lista. Un estado sin nadie
 * no lleva tramo, para que no quede un hueco de 2px suelto. */
function TotalsBar({
  totals,
}: {
  readonly totals: AttendanceTotals;
}): React.JSX.Element {
  return (
    <div className="attendance-totals-bar" aria-hidden="true">
      {ATTENDANCE_STATUSES.filter((status) => totals[status] > 0).map(
        (status) => (
          <span
            key={status}
            className={`attendance-totals-segment attendance-${status}`}
            data-status={status}
            style={{ flexGrow: totals[status] }}
          />
        ),
      )}
    </div>
  );
}

/** La lista se anuncia al cambiar: es lo que el Coach comprueba mientras
 * marca. */
function Totals({
  translate,
  totals,
}: {
  readonly translate: Translator;
  readonly totals: AttendanceTotals;
}): React.JSX.Element {
  return (
    <div className="attendance-totals">
      <div className="attendance-totals-line">
        <ul
          className="attendance-totals-list"
          aria-label={translate("attendance.totals.label")}
          aria-live="polite"
        >
          {ATTENDANCE_STATUSES.map((status) => (
            <li
              key={status}
              className={`attendance-total attendance-${status}`}
            >
              <span className="attendance-total-count">{totals[status]}</span>
              <span className="attendance-total-label">
                {translate(`attendance.status.${status}`)}
              </span>
            </li>
          ))}
        </ul>
        <p className="attendance-totals-came">
          {translate("attendance.totals.came", {
            came: cameCount(totals),
            total: totalCount(totals),
          })}
        </p>
      </div>
      <TotalsBar totals={totals} />
    </div>
  );
}

/** El separador y el punto son decoración; el espacio entre ellos separa
 * las dos partes del nombre accesible ("Save attendance 2 unsaved"). */
function SaveButton({
  translate,
  save,
  unsavedCount,
  isEmpty,
  onSave,
}: {
  readonly translate: Translator;
  readonly save: SaveState;
  readonly unsavedCount: number;
  readonly isEmpty: boolean;
  readonly onSave: () => void;
}): React.JSX.Element {
  const isSaving = save.kind === "saving";
  return (
    <button
      type="button"
      className="auth-submit attendance-save"
      disabled={isEmpty}
      aria-busy={isSaving}
      onClick={onSave}
    >
      <Icon glyph={FloppyDisk} weight="bold" />
      {translate(isSaving ? "attendance.saving" : "attendance.save")}
      {unsavedCount > 0 && !isSaving ? (
        <>
          <span className="attendance-save-divider" aria-hidden="true" />{" "}
          <span className="attendance-unsaved">
            <span className="attendance-save-dot" aria-hidden="true" />
            {translate("attendance.unsaved", { count: unsavedCount })}
          </span>
        </>
      ) : null}
    </button>
  );
}

/** En el móvil Guardar vive aquí, fija abajo sobre las pestañas, y sólo
 * mientras hay algo que guardar. */
function PhoneSaveBar({
  translate,
  save,
  unsavedCount,
  onSave,
}: {
  readonly translate: Translator;
  readonly save: SaveState;
  readonly unsavedCount: number;
  readonly onSave: () => void;
}): React.JSX.Element {
  const isSaving = save.kind === "saving";
  return (
    <div className="attendance-save-bar">
      <p className="attendance-save-bar-count">
        <span className="attendance-unsaved-dot" aria-hidden="true" />
        {translate("attendance.unsaved", { count: unsavedCount })}
      </p>
      <button
        type="button"
        className="auth-submit attendance-save-bar-button"
        aria-busy={isSaving}
        onClick={onSave}
      >
        {translate(isSaving ? "attendance.saving" : "attendance.save")}
      </button>
    </div>
  );
}

/** Siempre en el DOM: un lector de pantalla sólo anuncia los cambios de una
 * región que ya estaba. */
function SaveNotices({
  translate,
  save,
}: {
  readonly translate: Translator;
  readonly save: SaveState;
}): React.JSX.Element {
  return (
    <>
      <p className="attendance-notice" role="status">
        {save.kind === "saved" ? (
          <>
            <Icon glyph={CheckCircle} weight="fill" />
            {translate("attendance.saved", { ...save.totals })}
          </>
        ) : null}
      </p>
      {save.kind === "failed" ? (
        <p className="auth-error" role="alert">
          {describeAttendanceFailure(translate, save.failure)}
        </p>
      ) : null}
    </>
  );
}

type MemberRowsProps = {
  readonly translate: Translator;
  readonly viewer: RowViewer;
  readonly marks: SheetMarks;
  readonly onMark: AttendanceSheetControls["mark"];
};

function MemberGroup({
  translate,
  viewer,
  group,
  members,
  marks,
  onMark,
}: MemberRowsProps & {
  readonly group: RsvpGroup;
  readonly members: readonly SheetMember[];
}): React.JSX.Element {
  const headingId = `asistencia-grupo-${group}`;
  return (
    <section className="attendance-group" aria-labelledby={headingId}>
      {/* La lista ya anuncia cuántas filas tiene: el número es para la vista. */}
      <div className="attendance-group-header">
        <h2 id={headingId} className="attendance-group-title">
          {translate(`attendance.group.${group}`)}
        </h2>
        <span className="attendance-group-count" aria-hidden="true">
          {members.length}
        </span>
      </div>
      <ul className="attendance-list" aria-labelledby={headingId}>
        {members.map((member) => (
          <AttendanceRow
            key={member.userId}
            translate={translate}
            member={member}
            viewer={viewer}
            status={statusOf(marks, member.userId)}
            isUnsaved={isMemberUnsaved(marks, member.userId)}
            onMark={(status) => onMark(member.userId, status)}
          />
        ))}
      </ul>
    </section>
  );
}

/** Sin nadie que se llame así: lo dice y ofrece volver a ver a todos. */
function NoMatches({
  translate,
  onShowAll,
}: {
  readonly translate: Translator;
  readonly onShowAll: () => void;
}): React.JSX.Element {
  return (
    <div className="attendance-no-matches">
      <p className="admin-empty">{translate("attendance.search.noMatches")}</p>
      <button type="button" className="auth-secondary" onClick={onShowAll}>
        {translate("attendance.search.showAll")}
      </button>
    </div>
  );
}

/** Un grupo sin nadie no se pinta, ni su cabecera. */
function MemberList({
  translate,
  viewer,
  members: shown,
  marks,
  onMark,
}: MemberRowsProps & {
  readonly members: readonly SheetMember[];
}): React.JSX.Element {
  return (
    <>
      {RSVP_GROUPS.map((group) => {
        const members = shown.filter((member) => groupOf(member) === group);
        return members.length === 0 ? null : (
          <MemberGroup
            key={group}
            translate={translate}
            viewer={viewer}
            group={group}
            members={members}
            marks={marks}
            onMark={onMark}
          />
        );
      })}
    </>
  );
}

function SheetBody({
  translate,
  controls,
  canLeaveSheet,
}: {
  readonly translate: Translator;
  readonly controls: AttendanceSheetControls;
  readonly canLeaveSheet: () => boolean;
}): React.JSX.Element {
  const { state } = controls;
  switch (state.kind) {
    case "loading":
      return (
        <p className="admin-empty">{translate("attendance.loadingSheet")}</p>
      );
    case "failed":
      return (
        <div className="admin-load-failure">
          <p className="auth-error" role="alert">
            {describeAttendanceFailure(translate, state.failure)}
          </p>
          <button
            type="button"
            className="auth-submit"
            onClick={controls.retry}
          >
            {translate("attendance.retry")}
          </button>
        </div>
      );
    case "ready":
      return (
        <ReadySheet
          translate={translate}
          sheet={state.sheet}
          marks={state.marks}
          onMark={controls.mark}
          canLeaveSheet={canLeaveSheet}
        />
      );
  }
}

/** Los totales, el buscador y la lista de una hoja abierta. */
function ReadySheet({
  translate,
  sheet,
  marks,
  onMark,
  canLeaveSheet,
}: {
  readonly translate: Translator;
  readonly sheet: OpenedSheet;
  readonly marks: SheetMarks;
  readonly onMark: AttendanceSheetControls["mark"];
  readonly canLeaveSheet: () => boolean;
}): React.JSX.Element {
  const [query, setQuery] = useState("");
  const search = query.trim();
  const shown = sheet.members.filter((member) =>
    matchesNameSearch(member.fullName, search),
  );
  return (
    <>
      <Totals translate={translate} totals={totalsOf(marks)} />
      {sheet.members.length === 0 ? (
        <p className="admin-empty">{translate("attendance.emptySheet")}</p>
      ) : (
        <>
          <AttendanceSearch
            translate={translate}
            query={query}
            onQueryChange={setQuery}
          />
          {/* Siempre en el DOM: sólo se anuncia lo que cambia en una región
              que ya estaba. Fuera de un `status`, para no confundirse con el
              aviso de guardado. */}
          <p className="visually-hidden" aria-live="polite">
            {search === ""
              ? ""
              : translate("attendance.search.showing", {
                  shown: shown.length,
                  total: sheet.members.length,
                })}
          </p>
          {shown.length === 0 ? (
            <NoMatches translate={translate} onShowAll={() => setQuery("")} />
          ) : (
            <MemberList
              translate={translate}
              viewer={{ kind: sheet.viewer, canLeaveSheet }}
              members={shown}
              marks={marks}
              onMark={onMark}
            />
          )}
        </>
      )}
    </>
  );
}

export function AttendanceSheetPanel({
  translate,
  eventId,
  sessions,
  onChooseSession,
}: {
  readonly translate: Translator;
  readonly eventId: string;
  readonly sessions: readonly SessionChoice[];
  readonly onChooseSession: (eventId: string) => void;
}): React.JSX.Element {
  const controls = useAttendanceSheet(eventId);
  const { state } = controls;
  const isPhone = useIsPhone();
  const unsavedCount = state.kind === "ready" ? countUnsaved(state.marks) : 0;
  const hasChanges = unsavedCount > 0;

  // Lo preguntan las fichas de sesión y el nombre que abre la ficha (#414).
  // El diálogo nativo basta: es una pregunta de sí o no, el navegador la
  // hace accesible y devuelve el foco a lo que la abrió.
  function canLeaveSheet(): boolean {
    return (
      !hasChanges || window.confirm(translate("attendance.discardQuestion"))
    );
  }

  function chooseSession(choice: string): void {
    if (choice === eventId || !canLeaveSheet()) {
      return;
    }
    onChooseSession(choice);
  }

  return (
    <>
      <header className="attendance-header">
        <div>
          <p className="attendance-eyebrow">
            {translate("attendance.eyebrow")}
          </p>
          <h1>
            {state.kind === "ready"
              ? sheetTitle(translate, state.sheet)
              : translate("nav.label.attendance")}
          </h1>
        </div>
        {state.kind === "ready" && !isPhone ? (
          <SaveButton
            translate={translate}
            save={state.save}
            unsavedCount={unsavedCount}
            isEmpty={state.sheet.members.length === 0}
            onSave={() => void controls.save()}
          />
        ) : null}
      </header>
      {sessions.length === 0 ? null : (
        <SessionChips
          translate={translate}
          sessions={sessions}
          openedId={eventId}
          onChoose={chooseSession}
          canLeaveSheet={canLeaveSheet}
        />
      )}
      {state.kind === "ready" ? (
        <SaveNotices translate={translate} save={state.save} />
      ) : null}
      <SheetBody
        translate={translate}
        controls={controls}
        canLeaveSheet={canLeaveSheet}
      />
      {state.kind === "ready" && isPhone && hasChanges ? (
        <PhoneSaveBar
          translate={translate}
          save={state.save}
          unsavedCount={unsavedCount}
          onSave={() => void controls.save()}
        />
      ) : null}
    </>
  );
}
