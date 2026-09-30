"use client";

import {
  ATTENDANCE_STATUSES,
  type AttendanceTotals,
} from "@/lib/attendance/attendance-status";
import type { RsvpResponse } from "@/lib/events/event-rsvp";
import type { Translator } from "@/lib/i18n/translator";
import {
  type OpenedSheet,
  type SessionChoice,
  type SheetMember,
  describeAttendanceFailure,
} from "./attendance-client";
import {
  type SheetMarks,
  hasUnsavedChanges,
  statusOf,
  totalsOf,
} from "./attendance-marks";
import { AttendanceRow, type RowViewer } from "./AttendanceRow";
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
}: {
  readonly translate: Translator;
  readonly sessions: readonly SessionChoice[];
  readonly openedId: string;
  readonly onChoose: (eventId: string) => void;
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
    </div>
  );
}

/** Se anuncian al cambiar: es lo que el Coach comprueba mientras marca. */
function Totals({
  translate,
  totals,
}: {
  readonly translate: Translator;
  readonly totals: AttendanceTotals;
}): React.JSX.Element {
  return (
    <ul
      className="attendance-totals"
      aria-label={translate("attendance.totals.label")}
      aria-live="polite"
    >
      {ATTENDANCE_STATUSES.map((status) => (
        <li key={status} className={`attendance-total attendance-${status}`}>
          <span className="attendance-total-count">{totals[status]}</span>
          <span className="attendance-total-label">
            {translate(`attendance.status.${status}`)}
          </span>
        </li>
      ))}
    </ul>
  );
}

function SaveButton({
  translate,
  save,
  hasChanges,
  isEmpty,
  onSave,
}: {
  readonly translate: Translator;
  readonly save: SaveState;
  readonly hasChanges: boolean;
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
      {translate(isSaving ? "attendance.saving" : "attendance.save")}
      {hasChanges && !isSaving ? (
        <>
          {" · "}
          <span className="attendance-unsaved">
            {translate("attendance.unsaved")}
          </span>
        </>
      ) : null}
    </button>
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
        {save.kind === "saved"
          ? translate("attendance.saved", { ...save.totals })
          : null}
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
      <h2 id={headingId} className="attendance-group-title">
        {translate(`attendance.group.${group}`)}
      </h2>
      <ul className="attendance-list" aria-labelledby={headingId}>
        {members.map((member) => (
          <AttendanceRow
            key={member.userId}
            translate={translate}
            member={member}
            viewer={viewer}
            status={statusOf(marks, member.userId)}
            onMark={(status) => onMark(member.userId, status)}
          />
        ))}
      </ul>
    </section>
  );
}

/** Un grupo sin nadie no se pinta, ni su cabecera. */
function MemberList({
  translate,
  viewer,
  sheet,
  marks,
  onMark,
}: MemberRowsProps & { readonly sheet: OpenedSheet }): React.JSX.Element {
  if (sheet.members.length === 0) {
    return <p className="admin-empty">{translate("attendance.emptySheet")}</p>;
  }
  return (
    <>
      {RSVP_GROUPS.map((group) => {
        const members = sheet.members.filter(
          (member) => groupOf(member) === group,
        );
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
        <>
          <Totals translate={translate} totals={totalsOf(state.marks)} />
          <MemberList
            translate={translate}
            viewer={{ kind: state.sheet.viewer, canLeaveSheet }}
            sheet={state.sheet}
            marks={state.marks}
            onMark={controls.mark}
          />
        </>
      );
  }
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
  const hasChanges = state.kind === "ready" && hasUnsavedChanges(state.marks);

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
        {state.kind === "ready" ? (
          <SaveButton
            translate={translate}
            save={state.save}
            hasChanges={hasChanges}
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
    </>
  );
}
