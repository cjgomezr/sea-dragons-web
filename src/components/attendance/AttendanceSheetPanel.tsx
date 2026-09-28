"use client";

import {
  ATTENDANCE_STATUSES,
  type AttendanceTotals,
} from "@/lib/attendance/attendance-status";
import type { Translator } from "@/lib/i18n/translator";
import {
  type OpenedSheet,
  type SessionChoice,
  describeAttendanceFailure,
} from "./attendance-client";
import {
  type SheetMarks,
  hasUnsavedChanges,
  statusOf,
  totalsOf,
} from "./attendance-marks";
import { AttendanceRow } from "./AttendanceRow";
import { sessionDay } from "./session-day";
import {
  type AttendanceSheetControls,
  type SaveState,
  useAttendanceSheet,
} from "./use-attendance-sheet";

/**
 * La hoja de una sesión (#395), siguiendo docs/mockups/attendance-light.png:
 * el título con la fecha y el botón de guardar, las fichas de las sesiones
 * recientes, los tres contadores y la lista.
 *
 * Se monta de nuevo con cada sesión (la pantalla le pone su id como clave),
 * así lo marcado en una no se cuela en otra. Por eso las fichas viven aquí:
 * son las que saben si hay cambios que descartar antes de irse.
 */

const TITLE_ID = "asistencia-titulo";
const MEMBERS_LABEL_ID = "asistencia-miembros";

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

function MemberList({
  translate,
  sheet,
  marks,
  onMark,
}: {
  readonly translate: Translator;
  readonly sheet: OpenedSheet;
  readonly marks: SheetMarks;
  readonly onMark: AttendanceSheetControls["mark"];
}): React.JSX.Element {
  if (sheet.members.length === 0) {
    return <p className="admin-empty">{translate("attendance.emptySheet")}</p>;
  }
  return (
    <>
      <h2 id={MEMBERS_LABEL_ID} className="visually-hidden">
        {translate("attendance.members.label")}
      </h2>
      <ul className="attendance-list" aria-labelledby={MEMBERS_LABEL_ID}>
        {sheet.members.map((member) => (
          <AttendanceRow
            key={member.userId}
            translate={translate}
            member={member}
            status={statusOf(marks, member.userId)}
            onMark={(status) => onMark(member.userId, status)}
          />
        ))}
      </ul>
    </>
  );
}

function SheetBody({
  translate,
  controls,
}: {
  readonly translate: Translator;
  readonly controls: AttendanceSheetControls;
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

  function chooseSession(choice: string): void {
    if (choice === eventId) {
      return;
    }
    // El diálogo nativo basta: es una pregunta de sí o no, el navegador la
    // hace accesible y devuelve el foco al botón que la abrió.
    if (
      hasChanges &&
      !window.confirm(translate("attendance.discardQuestion"))
    ) {
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
          <h1 id={TITLE_ID}>
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
      <SheetBody translate={translate} controls={controls} />
    </>
  );
}
