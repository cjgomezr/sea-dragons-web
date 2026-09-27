"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { EVALUATION_CATEGORIES_PATH } from "@/lib/auth/routes";
import type {
  EvaluationRoster as Roster,
  EvaluationRosterEntry,
} from "@/lib/evaluations/evaluation-roster";
import type { MemberEvaluation } from "@/lib/evaluations/member-evaluation";
import type { Locale } from "@/lib/i18n/locale";
import { type Translator, createTranslator } from "@/lib/i18n/translator";
import { EvaluationRoster, rosterButtonId } from "./EvaluationRoster";
import { EvaluationSheet } from "./EvaluationSheet";
import {
  type EvaluationFailure,
  describeEvaluationFailure,
  loadEvaluationRoster,
} from "./evaluations-client";

/**
 * La pantalla de Evaluaciones (#322, RF-6 del PRD de E9): la lista de
 * miembros con su OVR, la ficha de quien se elija y la edición de sus
 * valoraciones.
 *
 * Quién llega lo decide la frontera: `EVALUATIONS_PATH` está en
 * `RESTRICTED_ROUTES` para Admin y Coach, y los endpoints lo vuelven a
 * comprobar (FR-055). Es de cliente, como el directorio, porque su razón de
 * ser es cambiar sin recargar, y lee por la API v1 que usará la aplicación
 * nativa de Release 2 (CON-002).
 *
 * Con `initialMemberId` abre ya la ficha de ese miembro: es a donde lleva la
 * marca de sin evaluar del directorio (#324). Si no está en la lista, se
 * queda en la lista.
 *
 * En escritorio la lista y la ficha van lado a lado. En el móvil no caben, y
 * son dos pasos: `data-step` le dice al CSS cuál enseñar, igual que la lista
 * de avisos de #266.
 */

type RosterState =
  | { readonly kind: "loading" }
  | { readonly kind: "failed"; readonly failure: EvaluationFailure }
  | { readonly kind: "ready"; readonly roster: Roster };

function LoadFailure({
  translate,
  failure,
  onRetry,
}: {
  translate: Translator;
  failure: EvaluationFailure;
  onRetry: () => void;
}): React.JSX.Element {
  return (
    <div className="admin-load-failure">
      <p className="auth-error" role="alert">
        {describeEvaluationFailure(translate, failure)}
      </p>
      <button type="button" className="auth-submit" onClick={onRetry}>
        {translate("evaluations.retry")}
      </button>
    </div>
  );
}

/** La fila de la lista con lo que el servidor acaba de confirmar. */
function toRosterEntry(
  entry: EvaluationRosterEntry,
  evaluation: MemberEvaluation,
): EvaluationRosterEntry {
  const { userId, fullName } = entry;
  return evaluation.status === "evaluated"
    ? {
        status: "evaluated",
        userId,
        fullName,
        overallRating: evaluation.overallRating,
      }
    : { status: "not_evaluated", userId, fullName };
}

function withEvaluation(roster: Roster, evaluation: MemberEvaluation): Roster {
  return {
    members: roster.members.map((entry) =>
      entry.userId === evaluation.memberId
        ? toRosterEntry(entry, evaluation)
        : entry,
    ),
  };
}

export function EvaluationsScreen({
  locale,
  initialMemberId,
}: {
  locale: Locale;
  initialMemberId: string | null;
}): React.JSX.Element {
  const translate = createTranslator(locale);
  const [state, setState] = useState<RosterState>({ kind: "loading" });
  const [reloads, setReloads] = useState(0);
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(initialMemberId);
  // A quién devolver el foco al volver de la ficha a la lista.
  const [returnFocusTo, setReturnFocusTo] = useState<string | null>(null);

  useEffect(() => {
    let isCurrent = true;
    void loadEvaluationRoster().then((outcome) => {
      if (isCurrent) {
        setState(
          outcome.kind === "loaded"
            ? { kind: "ready", roster: outcome.roster }
            : { kind: "failed", failure: outcome },
        );
      }
    });
    return () => {
      isCurrent = false;
    };
  }, [reloads]);

  useEffect(() => {
    if (returnFocusTo !== null) {
      document.getElementById(rosterButtonId(returnFocusTo))?.focus();
    }
  }, [returnFocusTo]);

  function retryLoad(): void {
    setState({ kind: "loading" });
    setReloads((count) => count + 1);
  }

  function select(userId: string): void {
    setReturnFocusTo(null);
    setSelectedId(userId);
  }

  function goBack(): void {
    setReturnFocusTo(selectedId);
    setSelectedId(null);
  }

  function applyEvaluation(evaluation: MemberEvaluation): void {
    setState((current) =>
      current.kind === "ready"
        ? { kind: "ready", roster: withEvaluation(current.roster, evaluation) }
        : current,
    );
  }

  const selected =
    state.kind === "ready"
      ? state.roster.members.find((member) => member.userId === selectedId)
      : undefined;

  return (
    <div className="evaluations" data-step={selected ? "sheet" : "list"}>
      <header className="evaluations-header">
        <div className="evaluations-heading">
          <h1>{translate("evaluations.title")}</h1>
          <Link
            href={EVALUATION_CATEGORIES_PATH}
            className="admin-secondary evaluations-categories-link"
          >
            {translate("evaluations.categories.link")}
          </Link>
        </div>
        <p className="app-lead">{translate("evaluations.lead")}</p>
      </header>
      {state.kind === "loading" ? (
        <p className="admin-empty">{translate("evaluations.loading")}</p>
      ) : null}
      {state.kind === "failed" ? (
        <LoadFailure
          translate={translate}
          failure={state.failure}
          onRetry={retryLoad}
        />
      ) : null}
      {state.kind === "ready" ? (
        <div className="evaluations-panes">
          <EvaluationRoster
            translate={translate}
            members={state.roster.members}
            search={search}
            onSearchChange={setSearch}
            selectedId={selectedId}
            onSelect={select}
          />
          {selected ? (
            <EvaluationSheet
              key={selected.userId}
              translate={translate}
              memberId={selected.userId}
              fullName={selected.fullName}
              onBack={goBack}
              onEvaluationChange={applyEvaluation}
            />
          ) : (
            <p className="evaluation-sheet-placeholder">
              {translate("evaluations.sheet.placeholder")}
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}
