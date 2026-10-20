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
  type TeamsChangeOutcome,
  type TeamsFailure,
  describeTeamsFailure,
} from "./team-builder-client";

/**
 * Editar el nombre y el color de un equipo (#760, RF-6 del PRD de E28),
 * desde el botón del lápiz de su tarjeta. En escritorio es una ventana de
 * 320 px anclada a la cabecera de la columna
 * (`docs/design/design_handoff_teams/screenshots/02-desktop-edit-team.png`);
 * en el móvil, la hoja de abajo de la ficha del socio y de las posiciones.
 *
 * Lo que se aplica son los equipos del club: valen para todos los eventos
 * desde ahora y para el borrador abierto, no para lo ya publicado (D4).
 */

export type ChangeTeams = (teams: TeamLabels) => Promise<TeamsChangeOutcome>;

type EditedTeam = {
  readonly translate: Translator;
  readonly team: TeamId;
  readonly teams: TeamLabels;
  readonly onChangeTeams: ChangeTeams;
};

type Submission =
  | { readonly kind: "idle" }
  | { readonly kind: "sending" }
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
  nameRef,
  onApplied,
  onCancel,
}: EditedTeam & {
  readonly nameRef?: React.RefObject<HTMLInputElement | null>;
  readonly onApplied: () => void;
  readonly onCancel: () => void;
}): React.JSX.Element {
  const nameId = useId();
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
    setSubmission({ kind: "failed", failure: outcome });
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
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    nameRef.current?.focus();
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
      onKeyDown={(event) => cycleFocus(event, panelRef.current)}
    >
      <h3 id={titleId} className="team-edit-title">
        {edited.translate("teams.edit.title")}
      </h3>
      <TeamEditForm
        {...edited}
        nameRef={nameRef}
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
          <TeamEditForm {...edited} onApplied={close} onCancel={close} />
        </div>
      )}
    </BottomSheet>
  );
}

/** El lápiz de la cabecera de un equipo y lo que abre. Al cerrar, el foco
 * vuelve a él. */
export function TeamEditControl(edited: EditedTeam): React.JSX.Element {
  const isPhone = useIsPhone();
  const [isOpen, setIsOpen] = useState(false);
  const anchorRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const close = useCallback(() => {
    setIsOpen(false);
    buttonRef.current?.focus();
  }, []);

  return (
    <div ref={anchorRef} className="team-edit">
      <button
        ref={buttonRef}
        type="button"
        className="team-edit-open"
        aria-label={edited.translate("teams.edit.open", {
          team: edited.teams[edited.team].name,
        })}
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
