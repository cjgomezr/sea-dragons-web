"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { MemberAvatar } from "@/components/MemberAvatar";
import { memberRecordHref } from "@/lib/auth/routes";
import { positionName } from "@/lib/club/club-positions";
import type { EvaluationCategories } from "@/lib/evaluations/evaluation-categories";
import type { MemberEvaluation } from "@/lib/evaluations/member-evaluation";
import type { ListPosition } from "@/lib/evaluations/sheet-navigation";
import type { Translator } from "@/lib/i18n/translator";
import { EvaluationScores } from "./EvaluationScores";
import { OverallScore } from "./OverallScore";
import {
  type EvaluationFailure,
  type ScreenRosterEntry,
  createMemberEvaluation,
  describeEvaluationFailure,
  isStaleEvaluation,
  loadMemberEvaluation,
} from "./evaluations-client";

/**
 * La ficha de un miembro en Evaluaciones (#322): su evaluación, o la oferta
 * de crearla si no la tiene. Desde #819 (RF-3 del PRD de E31) es el panel
 * lateral: arriba dice dónde está en la lista filtrada, con cerrar, anterior
 * y siguiente; debajo, la identidad con el OVR. En el móvil es el segundo
 * paso, así que lleva además su propio botón de volver a la lista.
 *
 * La pantalla la monta con `key` por miembro: cambiar de miembro empieza de
 * cero, sin arrastrar lo ajustado de otro.
 */

const AVATAR_SIZE = 56;

type SheetState =
  | { readonly kind: "loading" }
  | { readonly kind: "failed"; readonly failure: EvaluationFailure }
  | {
      readonly kind: "ready";
      readonly evaluation: MemberEvaluation;
      /** Recién creada: se abre ya editando. */
      readonly isNew: boolean;
    };

type CreationStatus =
  | { readonly kind: "idle" }
  | { readonly kind: "creating" }
  | { readonly kind: "failed"; readonly failure: EvaluationFailure };

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

/** Si otro la creó entretanto, crear otra vez fallaría siempre: lo que se
 * ofrece es recargar. */
function CreationAction({
  translate,
  status,
  onCreate,
  onReload,
}: {
  translate: Translator;
  status: CreationStatus;
  onCreate: () => void;
  onReload: () => void;
}): React.JSX.Element {
  if (status.kind === "failed" && isStaleEvaluation(status.failure)) {
    return (
      <button type="button" className="admin-secondary" onClick={onReload}>
        {translate("evaluations.reload")}
      </button>
    );
  }
  const isCreating = status.kind === "creating";
  return (
    <button
      type="button"
      className="auth-submit"
      disabled={isCreating}
      onClick={onCreate}
    >
      {translate(isCreating ? "evaluations.creating" : "evaluations.create")}
    </button>
  );
}

function NotEvaluated({
  translate,
  fullName,
  status,
  onCreate,
  onReload,
}: {
  translate: Translator;
  fullName: string;
  status: CreationStatus;
  onCreate: () => void;
  onReload: () => void;
}): React.JSX.Element {
  return (
    <div className="evaluation-missing">
      <p className="evaluation-missing-title">
        {translate("evaluations.notEvaluated.title", { name: fullName })}
      </p>
      <p className="evaluation-missing-hint">
        {translate("evaluations.notEvaluated.hint")}
      </p>
      {status.kind === "failed" ? (
        <p className="auth-error" role="alert">
          {describeEvaluationFailure(translate, status.failure)}
        </p>
      ) : null}
      <CreationAction
        translate={translate}
        status={status}
        onCreate={onCreate}
        onReload={onReload}
      />
    </div>
  );
}

function NavButton({
  label,
  glyph,
  targetId,
  onNavigate,
}: {
  label: string;
  glyph: string;
  targetId: string | null;
  onNavigate: (userId: string) => void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      className="evaluation-sheet-nav-button"
      aria-label={label}
      disabled={targetId === null}
      onClick={() => {
        if (targetId !== null) {
          onNavigate(targetId);
        }
      }}
    >
      <span aria-hidden="true">{glyph}</span>
    </button>
  );
}

/** "{i} de {n} en esta lista" o que no está en el filtro, con cerrar,
 * anterior y siguiente. */
function SheetNav({
  translate,
  position,
  onClose,
  onNavigate,
}: {
  translate: Translator;
  position: ListPosition;
  onClose: () => void;
  onNavigate: (userId: string) => void;
}): React.JSX.Element {
  return (
    <div className="evaluation-sheet-nav">
      <p>
        {position.kind === "listed"
          ? translate("evaluations.sheet.listPosition", {
              position: position.index + 1,
              total: position.count,
            })
          : translate("evaluations.sheet.outOfFilter")}
      </p>
      <button
        type="button"
        className="evaluation-sheet-nav-button evaluation-sheet-close"
        aria-label={translate("evaluations.sheet.close")}
        onClick={onClose}
      >
        <span aria-hidden="true">×</span>
      </button>
      <NavButton
        label={translate("evaluations.sheet.previous")}
        glyph="‹"
        targetId={position.previousId}
        onNavigate={onNavigate}
      />
      <NavButton
        label={translate("evaluations.sheet.next")}
        glyph="›"
        targetId={position.nextId}
        onNavigate={onNavigate}
      />
    </div>
  );
}

/** "posición · Perfil": el enlace sólo si quien mira puede abrir la ficha
 * del socio (#770). */
function IdentityLine({
  translate,
  member,
  canOpenMemberRecords,
}: {
  translate: Translator;
  member: ScreenRosterEntry;
  canOpenMemberRecords: boolean;
}): React.JSX.Element | null {
  const position =
    member.position === null
      ? null
      : positionName(member.position.names, translate.locale);
  if (position === null && !canOpenMemberRecords) {
    return null;
  }
  return (
    <p className="evaluation-sheet-identity">
      {position}
      {position !== null && canOpenMemberRecords ? " · " : null}
      {canOpenMemberRecords ? (
        <Link href={memberRecordHref(member.userId)}>
          {translate("evaluations.sheet.profile")}
        </Link>
      ) : null}
    </p>
  );
}

/** Quién la editó por última vez lo trae la lista, no la ficha. La pantalla
 * pone la fila al día con cada lectura y cada guardado, y lo deja en `null`
 * si la versión cambió. */
function updatedByOf(member: ScreenRosterEntry): string | null {
  return member.status === "evaluated" ? member.updatedBy : null;
}

function overallOf(state: SheetState): number | null {
  return state.kind === "ready" && state.evaluation.status === "evaluated"
    ? state.evaluation.overallRating
    : null;
}

export function EvaluationSheet({
  translate,
  member,
  categories,
  canOpenMemberRecords,
  position,
  onClose,
  onNavigate,
  onEvaluationChange,
}: {
  translate: Translator;
  member: ScreenRosterEntry;
  /** Las del club, para las notas en su orden; `null` si no se pudieron
   * leer. */
  categories: EvaluationCategories | null;
  canOpenMemberRecords: boolean;
  /** Dónde está dentro de la lista filtrada. */
  position: ListPosition;
  onClose: () => void;
  onNavigate: (userId: string) => void;
  /** Lo que el servidor confirmó o devolvió al leer, para que la lista ponga
   * el OVR al día. */
  onEvaluationChange: (evaluation: MemberEvaluation) => void;
}): React.JSX.Element {
  const { userId: memberId, fullName } = member;
  const [state, setState] = useState<SheetState>({ kind: "loading" });
  const [creation, setCreation] = useState<CreationStatus>({ kind: "idle" });
  // Recargar cuenta como una lectura más, aunque sea del mismo miembro.
  const [reloads, setReloads] = useState(0);
  // La lista se pone al día también con lo que se lee, no sólo con lo que se
  // guarda: tras un 409 la ficha y la lista tienen que decir el mismo OVR. Por
  // referencia, para que un callback nuevo en cada render no relance la
  // lectura.
  const notifyChange = useRef(onEvaluationChange);
  useEffect(() => {
    notifyChange.current = onEvaluationChange;
  }, [onEvaluationChange]);

  useEffect(() => {
    let isCurrent = true;
    void loadMemberEvaluation(memberId).then((outcome) => {
      if (!isCurrent) {
        return;
      }
      if (outcome.kind === "failed") {
        setState({ kind: "failed", failure: outcome });
        return;
      }
      setState({ kind: "ready", evaluation: outcome.evaluation, isNew: false });
      notifyChange.current(outcome.evaluation);
    });
    return () => {
      isCurrent = false;
    };
  }, [memberId, reloads]);

  function reload(): void {
    setState({ kind: "loading" });
    setCreation({ kind: "idle" });
    setReloads((count) => count + 1);
  }

  function showConfirmed(evaluation: MemberEvaluation, isNew: boolean): void {
    setState({ kind: "ready", evaluation, isNew });
    onEvaluationChange(evaluation);
  }

  async function create(): Promise<void> {
    setCreation({ kind: "creating" });
    const outcome = await createMemberEvaluation(memberId);
    if (outcome.kind === "failed") {
      setCreation({ kind: "failed", failure: outcome });
      return;
    }
    setCreation({ kind: "idle" });
    showConfirmed(outcome.evaluation, true);
  }

  return (
    <section
      className="evaluation-sheet"
      aria-label={translate("evaluations.sheet.label", { name: fullName })}
    >
      <button type="button" className="evaluation-back" onClick={onClose}>
        <span aria-hidden="true">←</span>
        {translate("evaluations.sheet.back")}
      </button>
      <SheetNav
        translate={translate}
        position={position}
        onClose={onClose}
        onNavigate={onNavigate}
      />
      <header className="evaluation-sheet-header">
        <MemberAvatar
          fullName={fullName}
          photoUrl={member.photoUrl}
          size={AVATAR_SIZE}
          className="evaluation-avatar"
        />
        <div className="evaluation-sheet-who">
          <h2>{fullName}</h2>
          <IdentityLine
            translate={translate}
            member={member}
            canOpenMemberRecords={canOpenMemberRecords}
          />
        </div>
        <OverallScore translate={translate} overallRating={overallOf(state)} />
      </header>
      {state.kind === "loading" ? (
        <p className="admin-empty">{translate("evaluations.sheet.loading")}</p>
      ) : null}
      {state.kind === "failed" ? (
        <LoadFailure
          translate={translate}
          failure={state.failure}
          onRetry={reload}
        />
      ) : null}
      {state.kind === "ready" && state.evaluation.status === "not_evaluated" ? (
        <NotEvaluated
          translate={translate}
          fullName={fullName}
          status={creation}
          onCreate={() => void create()}
          onReload={reload}
        />
      ) : null}
      {state.kind === "ready" && state.evaluation.status === "evaluated" ? (
        <EvaluationScores
          translate={translate}
          evaluation={state.evaluation}
          categories={categories}
          updatedBy={updatedByOf(member)}
          isEditingAtStart={state.isNew}
          onSaved={(evaluation) => showConfirmed(evaluation, false)}
          onRefreshed={(evaluation) => showConfirmed(evaluation, false)}
          onReload={reload}
        />
      ) : null}
    </section>
  );
}
