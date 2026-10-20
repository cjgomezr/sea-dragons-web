"use client";

import { Check } from "@phosphor-icons/react/dist/ssr/Check";
import { Info } from "@phosphor-icons/react/dist/ssr/Info";
import { PencilSimple } from "@phosphor-icons/react/dist/ssr/PencilSimple";
import { Prohibit } from "@phosphor-icons/react/dist/ssr/Prohibit";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { BottomSheet } from "@/components/directory/BottomSheet";
import { cycleFocus, focusableIn } from "@/components/focus-cycle";
import { Icon } from "@/components/Icon";
import { useDismissal } from "@/components/use-dismissal";
import { useIsPhone } from "@/components/use-is-phone";
import type { Translator } from "@/lib/i18n/translator";
import { TEAM_BIB_COLORS, nameTeamColor } from "@/lib/teams/team-color-name";
import {
  CLUB_TEAM_NAME_MAX_LENGTH,
  type TeamId,
  type TeamLabel,
  type TeamLabels,
} from "@/lib/teams/team-ids";
import {
  type TeamsEditOutcome,
  type TeamsFailure,
  describeTeamsFailure,
  loadClubTeams,
} from "./team-builder-client";

/**
 * Editar el nombre y el color de un equipo (#760, RF-6 del PRD de E28),
 * desde el botón del lápiz de su tarjeta. En escritorio es una ventana de
 * 320 px anclada a la cabecera de la columna
 * (`docs/design/design_handoff_teams/screenshots/02-desktop-edit-team.png`);
 * en el móvil, la hoja de abajo de la ficha del socio y de las posiciones.
 *
 * Lo que se edita son los equipos del club, que se piden al abrir: un
 * reparto guardado conserva sus nombres y colores (D4, D5), así que los de
 * la tarjeta pueden no ser los del club. Lo aplicado vale para todos los
 * eventos desde ahora y para el borrador abierto.
 */

export type ChangeTeams = (teams: TeamLabels) => Promise<TeamsEditOutcome>;

type EditedTeam = {
  readonly translate: Translator;
  readonly team: TeamId;
  readonly onChangeTeams: ChangeTeams;
};

type ClubTeamsState =
  | { readonly kind: "loading" }
  | { readonly kind: "failed"; readonly failure: TeamsFailure }
  | { readonly kind: "loaded"; readonly teams: TeamLabels };

type Submission =
  | { readonly kind: "idle" }
  | { readonly kind: "sending" }
  | { readonly kind: "busy" }
  | { readonly kind: "failed"; readonly failure: TeamsFailure };

function otherTeam(team: TeamId): TeamId {
  return team === "a" ? "b" : "a";
}

function withLabel(
  teams: TeamLabels,
  team: TeamId,
  label: TeamLabel,
): TeamLabels {
  return team === "a" ? { a: label, b: teams.b } : { a: teams.a, b: label };
}

/** "Azul", con mayúscula: el handoff nombra así cada peto. */
function colorLabel(translate: Translator, hex: string): string {
  const name = translate(`calendar.teams.color.${nameTeamColor(hex)}`);
  return `${name.charAt(0).toLocaleUpperCase(translate.locale)}${name.slice(1)}`;
}

/** Un 400 dice qué campo falla; los demás fallos, lo de siempre. */
function describeEditFailure(
  translate: Translator,
  failure: TeamsFailure,
): string {
  return failure.failure === "validation_error"
    ? translate("teams.edit.invalid")
    : describeTeamsFailure(translate, failure);
}

function ColorChoices({
  translate,
  chosen,
  taken,
  onChoose,
}: {
  readonly translate: Translator;
  readonly chosen: string;
  readonly taken: TeamLabel;
  readonly onChoose: (hex: string) => void;
}): React.JSX.Element {
  const labelId = useId();
  const groupName = useId();
  const isSwatch = TEAM_BIB_COLORS.some((swatch) => swatch.hex === chosen);
  return (
    <div className="team-edit-field">
      <p id={labelId} className="team-edit-label">
        {translate("teams.edit.color")}
        {isSwatch ? (
          <>
            {" "}
            <span className="team-edit-color-name">
              {`· ${colorLabel(translate, chosen)}`}
            </span>
          </>
        ) : null}
      </p>
      <div
        role="radiogroup"
        aria-labelledby={labelId}
        className="team-edit-swatches"
      >
        {TEAM_BIB_COLORS.map((swatch) => {
          const isTaken = swatch.hex === taken.color.toUpperCase();
          const isChosen = swatch.hex === chosen;
          const name = colorLabel(translate, swatch.hex);
          return (
            <label
              key={swatch.hex}
              className="team-edit-swatch"
              data-tone={swatch.textTone}
              style={{ "--swatch-color": swatch.hex } as React.CSSProperties}
            >
              <input
                type="radio"
                name={groupName}
                value={swatch.hex}
                checked={isChosen}
                disabled={isTaken}
                aria-label={
                  isTaken
                    ? translate("teams.edit.colorTaken", {
                        color: name,
                        team: taken.name,
                      })
                    : name
                }
                onChange={() => onChoose(swatch.hex)}
              />
              <span className="team-edit-swatch-mark" aria-hidden="true">
                {isChosen ? <Icon glyph={Check} weight="bold" /> : null}
                {isTaken ? <Icon glyph={Prohibit} weight="bold" /> : null}
              </span>
            </label>
          );
        })}
      </div>
      <p className="team-edit-hint">{translate("teams.edit.takenHint")}</p>
    </div>
  );
}

/** El nombre, los colores, la ayuda y Cancelar y Aplicar: lo mismo en la
 * ventana y en la hoja. Lo escrito se queda si el servidor no lo acepta. */
function TeamEditForm({
  translate,
  team,
  teams,
  onChangeTeams,
  shouldFocusName,
  onApplied,
  onCancel,
}: EditedTeam & {
  readonly teams: TeamLabels;
  readonly shouldFocusName: boolean;
  readonly onApplied: () => void;
  readonly onCancel: () => void;
}): React.JSX.Element {
  const nameId = useId();
  const nameRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (shouldFocusName) {
      nameRef.current?.focus();
    }
  }, [shouldFocusName]);
  const [name, setName] = useState(teams[team].name);
  const [color, setColor] = useState(teams[team].color.toUpperCase());
  const [submission, setSubmission] = useState<Submission>({ kind: "idle" });
  // Dos clics seguidos llegan antes de que React vuelva a pintar.
  const isSendingRef = useRef(false);
  const isSending = submission.kind === "sending";
  const canApply = name.trim() !== "";

  async function apply(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (!canApply || isSendingRef.current) {
      return;
    }
    isSendingRef.current = true;
    setSubmission({ kind: "sending" });
    const outcome = await onChangeTeams(
      withLabel(teams, team, { name: name.trim(), color }),
    );
    isSendingRef.current = false;
    if (outcome.kind === "changed") {
      onApplied();
      return;
    }
    setSubmission(
      outcome.kind === "busy" ? outcome : { kind: "failed", failure: outcome },
    );
  }

  return (
    <form className="team-edit-form" onSubmit={(event) => void apply(event)}>
      <div className="team-edit-field">
        <label htmlFor={nameId} className="team-edit-label">
          {translate("teams.edit.name")}
        </label>
        <input
          id={nameId}
          ref={nameRef}
          className="team-edit-name"
          type="text"
          value={name}
          maxLength={CLUB_TEAM_NAME_MAX_LENGTH}
          autoComplete="off"
          onChange={(event) => setName(event.target.value)}
        />
      </div>
      <ColorChoices
        translate={translate}
        chosen={color}
        taken={teams[otherTeam(team)]}
        onChoose={setColor}
      />
      <p className="team-edit-scope">
        <Icon glyph={Info} />
        {translate("teams.edit.scope")}
      </p>
      {submission.kind === "failed" ? (
        <p className="auth-error" role="alert">
          {describeEditFailure(translate, submission.failure)}
        </p>
      ) : null}
      {submission.kind === "busy" ? (
        <p className="auth-error" role="alert">
          {translate("teams.edit.busy")}
        </p>
      ) : null}
      <div className="team-edit-actions">
        <button type="button" className="admin-secondary" onClick={onCancel}>
          {translate("teams.edit.cancel")}
        </button>
        <button
          type="submit"
          className="auth-submit"
          disabled={!canApply}
          aria-busy={isSending}
        >
          {translate(isSending ? "teams.edit.applying" : "teams.edit.apply")}
        </button>
      </div>
    </form>
  );
}

function useClubTeams(): ClubTeamsState {
  const [state, setState] = useState<ClubTeamsState>({ kind: "loading" });
  useEffect(() => {
    let isCurrent = true;
    void loadClubTeams().then((outcome) => {
      if (isCurrent) {
        setState(
          outcome.kind === "loaded"
            ? outcome
            : { kind: "failed", failure: outcome },
        );
      }
    });
    return () => {
      isCurrent = false;
    };
  }, []);
  return state;
}

/** Lo de dentro de la ventana o la hoja: mientras llegan los equipos del
 * club, una línea; si no llegan, el aviso y Cancelar. */
function ClubTeamsEditor({
  shouldFocusName,
  onApplied,
  onCancel,
  ...edited
}: EditedTeam & {
  readonly shouldFocusName: boolean;
  readonly onApplied: () => void;
  readonly onCancel: () => void;
}): React.JSX.Element {
  const clubTeams = useClubTeams();
  const { translate } = edited;
  if (clubTeams.kind === "loaded") {
    return (
      <TeamEditForm
        {...edited}
        teams={clubTeams.teams}
        shouldFocusName={shouldFocusName}
        onApplied={onApplied}
        onCancel={onCancel}
      />
    );
  }
  return (
    <div className="team-edit-form">
      {clubTeams.kind === "loading" ? (
        <p className="team-edit-hint" role="status">
          {translate("teams.edit.loading")}
        </p>
      ) : (
        <p className="auth-error" role="alert">
          {describeTeamsFailure(translate, clubTeams.failure)}
        </p>
      )}
      <div className="team-edit-actions">
        <button type="button" className="admin-secondary" onClick={onCancel}>
          {translate("teams.edit.cancel")}
        </button>
      </div>
    </div>
  );
}

/** La ventana de escritorio. Escape, Cancelar o un clic fuera la cierran;
 * mientras está abierta, Tab no sale de ella. */
function TeamEditPopover({
  anchorRef,
  onClosed,
  ...edited
}: EditedTeam & {
  /** El botón y la ventana: un clic ahí no es un clic fuera. */
  readonly anchorRef: React.RefObject<HTMLElement | null>;
  readonly onClosed: () => void;
}): React.JSX.Element {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);

  // Hasta que llega el nombre, el foco espera en la ventana.
  useEffect(() => {
    panelRef.current?.focus();
  }, []);

  const keepFocusInside = useCallback(() => {
    focusableIn(panelRef.current).at(0)?.focus();
  }, []);
  useDismissal({
    isOpen: true,
    containerRef: anchorRef,
    onEscape: onClosed,
    onPressOutside: onClosed,
    onFocusOutside: keepFocusInside,
  });

  return (
    <div
      ref={panelRef}
      className="team-edit-popover"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      tabIndex={-1}
      onKeyDown={(event) => cycleFocus(event, panelRef.current)}
    >
      <h3 id={titleId} className="team-edit-title">
        {edited.translate("teams.edit.title")}
      </h3>
      <ClubTeamsEditor
        {...edited}
        shouldFocusName
        onApplied={onClosed}
        onCancel={onClosed}
      />
    </div>
  );
}

function TeamEditSheet({
  onClosed,
  ...edited
}: EditedTeam & { readonly onClosed: () => void }): React.JSX.Element {
  return (
    <BottomSheet
      title={edited.translate("teams.edit.title")}
      gripLabel={edited.translate("teams.edit.close")}
      onClosed={onClosed}
    >
      {(close) => (
        <div className="team-edit-sheet">
          <ClubTeamsEditor
            {...edited}
            shouldFocusName={false}
            onApplied={close}
            onCancel={close}
          />
        </div>
      )}
    </BottomSheet>
  );
}

/** El lápiz de la cabecera de un equipo y lo que abre. Al cerrar, el foco
 * vuelve a él. */
export function TeamEditControl({
  teamName,
  ...edited
}: EditedTeam & {
  /** El de la tarjeta, que nombra al botón. */
  readonly teamName: string;
}): React.JSX.Element {
  const isPhone = useIsPhone();
  const [isOpen, setIsOpen] = useState(false);
  const anchorRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const close = useCallback(() => {
    setIsOpen(false);
    buttonRef.current?.focus();
  }, [setIsOpen]);

  return (
    <div ref={anchorRef} className="team-edit">
      <button
        ref={buttonRef}
        type="button"
        className="team-edit-open"
        aria-label={edited.translate("teams.edit.open", { team: teamName })}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        onClick={() => (isOpen ? close() : setIsOpen(true))}
      >
        <Icon glyph={PencilSimple} />
      </button>
      {isOpen && isPhone ? (
        <TeamEditSheet {...edited} onClosed={close} />
      ) : null}
      {isOpen && !isPhone ? (
        <TeamEditPopover {...edited} anchorRef={anchorRef} onClosed={close} />
      ) : null}
    </div>
  );
}
