"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { CALENDAR_PATH } from "@/lib/auth/routes";
import type { Locale } from "@/lib/i18n/locale";
import { type Translator, createTranslator } from "@/lib/i18n/translator";
import {
  type AttendanceFailure,
  type SessionChoice,
  describeAttendanceFailure,
  loadSessions,
} from "./attendance-client";
import { AttendanceSheetPanel } from "./AttendanceSheetPanel";

/**
 * La pantalla de Asistencia (#395, RF-8 del PRD de E8): donde Admin y Coach
 * pasan lista. Abre la sesión más reciente de los últimos 30 días, o la que
 * llega por `?sesion=` desde el calendario aunque sea más vieja.
 *
 * Es de cliente porque se marca sin recargar y los contadores cambian al
 * momento (FR-040). Lee y guarda sólo por la API v1 (#393), la misma que
 * usará la aplicación nativa de Release 2 (CON-002).
 */

type SessionsState =
  | { readonly kind: "loading" }
  | { readonly kind: "failed"; readonly failure: AttendanceFailure }
  | { readonly kind: "ready"; readonly sessions: readonly SessionChoice[] };

function useRecentSessions(): {
  readonly state: SessionsState;
  readonly retry: () => void;
} {
  const [state, setState] = useState<SessionsState>({ kind: "loading" });
  const [reloads, setReloads] = useState(0);

  useEffect(() => {
    let isCurrent = true;
    void loadSessions().then((outcome) => {
      if (isCurrent) {
        setState(
          outcome.kind === "loaded"
            ? { kind: "ready", sessions: outcome.sessions }
            : { kind: "failed", failure: outcome },
        );
      }
    });
    return () => {
      isCurrent = false;
    };
  }, [reloads]);

  function retry(): void {
    setState({ kind: "loading" });
    setReloads((count) => count + 1);
  }

  return { state, retry };
}

function ScreenHeading({
  translate,
}: {
  readonly translate: Translator;
}): React.JSX.Element {
  return (
    <header className="attendance-header">
      <h1>{translate("nav.label.attendance")}</h1>
    </header>
  );
}

function SessionsFailure({
  translate,
  failure,
  onRetry,
}: {
  readonly translate: Translator;
  readonly failure: AttendanceFailure;
  readonly onRetry: () => void;
}): React.JSX.Element {
  return (
    <div className="admin-load-failure">
      <p className="auth-error" role="alert">
        {describeAttendanceFailure(translate, failure)}
      </p>
      <button type="button" className="auth-submit" onClick={onRetry}>
        {translate("attendance.retry")}
      </button>
    </div>
  );
}

function NoSessions({
  translate,
}: {
  readonly translate: Translator;
}): React.JSX.Element {
  return (
    <div className="attendance-no-sessions">
      <p className="admin-empty">{translate("attendance.noSessions")}</p>
      <Link href={CALENDAR_PATH} className="admin-secondary">
        {translate("attendance.toCalendar")}
      </Link>
    </div>
  );
}

export function AttendanceScreen({
  locale,
  initialSessionId,
}: {
  readonly locale: Locale;
  /** La sesión de `?sesion=`, o null para abrir la más reciente. */
  readonly initialSessionId: string | null;
}): React.JSX.Element {
  const translate = createTranslator(locale);
  const sessions = useRecentSessions();
  const [chosenId, setChosenId] = useState<string | null>(initialSessionId);
  const recent = sessions.state.kind === "ready" ? sessions.state.sessions : [];
  const openedId = chosenId ?? recent.at(0)?.eventId ?? null;

  if (openedId !== null) {
    return (
      <div className="attendance">
        <AttendanceSheetPanel
          key={openedId}
          translate={translate}
          eventId={openedId}
          sessions={recent}
          onChooseSession={setChosenId}
        />
      </div>
    );
  }
  return (
    <div className="attendance">
      <ScreenHeading translate={translate} />
      {sessions.state.kind === "loading" ? (
        <p className="admin-empty">{translate("attendance.loading")}</p>
      ) : null}
      {sessions.state.kind === "failed" ? (
        <SessionsFailure
          translate={translate}
          failure={sessions.state.failure}
          onRetry={sessions.retry}
        />
      ) : null}
      {sessions.state.kind === "ready" ? (
        <NoSessions translate={translate} />
      ) : null}
    </div>
  );
}
