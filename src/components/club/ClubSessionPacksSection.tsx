"use client";

import { useEffect, useRef, useState } from "react";
import type { ApiRequestFailure } from "@/lib/api/request-api";
import {
  findSessionPackIssue,
  MAX_PACK_SESSIONS,
  MIN_PACK_SESSIONS,
  priceSessionPack,
  type SessionPackIssueCode,
} from "@/lib/club/session-packs";
import { formatAudCents } from "@/lib/i18n/format";
import type { Translator } from "@/lib/i18n/translator";
import type { ClubPrice } from "@/lib/membership/stripe-prices";
import {
  describeSessionPackIssue,
  describeSessionPacksFailure,
  loadSessionPacks,
  type SessionPacksDraft,
  saveSessionPacks,
} from "./club-session-packs-client";

/**
 * Los packs de sesiones que el club ofrece a sus Casual (#469, RF-4 del PRD
 * de E13). El Admin o el Committee añade, quita y ordena en un borrador, y lo
 * guarda entero con su botón: la API cambia la lista de una vez.
 *
 * El precio de cada pack es el de una sesión Casual en Stripe por su tamaño.
 * Lo calcula la pantalla con el precio que trae el endpoint, así que un pack
 * recién añadido ya enseña el suyo antes de guardarse.
 */

type Direction = "up" | "down";

type Status =
  | { readonly kind: "loading" }
  | { readonly kind: "editing" }
  | { readonly kind: "sending" }
  | { readonly kind: "invalid"; readonly code: SessionPackIssueCode }
  | ({ readonly phase: "load" | "save" } & ApiRequestFailure);

type PackControl = Direction | "remove";

/** El `data-focus-key` del control que recibe el foco cuando la sección se
 * vuelve a pintar. */
type FocusTarget = string;

const NEW_PACK_FIELD_ID = "club-packs-nuevo";
const NEW_PACK_ISSUE_ID = `${NEW_PACK_FIELD_ID}-aviso`;
const NEW_PACK_HINT_ID = `${NEW_PACK_FIELD_ID}-ayuda`;
const EMPTY_PACKS: SessionPacksDraft = {
  sizes: [],
  sessionPrice: { amountCents: null, reason: "not_configured" },
};

function packName(translate: Translator, sessions: number): string {
  return translate("clubSettings.sessionPacks.pack", { count: sessions });
}

function describePrice(translate: Translator, price: ClubPrice): string {
  return price.amountCents === null
    ? translate("payments.plan.priceUnavailable")
    : formatAudCents(translate.locale, price.amountCents);
}

function focusKey(sessions: number, control: PackControl): FocusTarget {
  return `pack-${sessions}-${control}`;
}

/** Cambia de sitio el pack de `sessions` con su vecino. En un extremo la
 * lista queda igual: el botón de ese sentido ya está desactivado. */
function swapWithNeighbour(
  sizes: readonly number[],
  sessions: number,
  direction: Direction,
): readonly number[] {
  const index = sizes.indexOf(sessions);
  const neighbourIndex = direction === "up" ? index - 1 : index + 1;
  const neighbour = sizes[neighbourIndex];
  if (index === -1 || neighbour === undefined) {
    return sizes;
  }
  return sizes.map((size, position) => {
    if (position === index) {
      return neighbour;
    }
    return position === neighbourIndex ? sessions : size;
  });
}

/** Tras mover, el foco se queda en el mismo botón si sigue activo, y si el
 * pack llegó a un extremo, en el del otro sentido. */
function focusAfterMove(
  sessions: number,
  newIndex: number,
  total: number,
  direction: Direction,
): FocusTarget {
  const isAtEdge = direction === "up" ? newIndex === 0 : newIndex === total - 1;
  const opposite = direction === "up" ? "down" : "up";
  return focusKey(sessions, isAtEdge ? opposite : direction);
}

type SessionPacksEditor = {
  readonly packs: SessionPacksDraft;
  readonly status: Status;
  readonly notice: string | null;
  readonly addIssue: SessionPackIssueCode | null;
  readonly focusTarget: FocusTarget | null;
  readonly move: (sessions: number, direction: Direction) => void;
  readonly remove: (sessions: number) => void;
  readonly add: (sessions: number) => boolean;
  readonly submit: () => Promise<void>;
};

/** Lee lo guardado una vez, al montar. Los setters de React no cambian, así
 * que el efecto no se repite. */
function useInitialLoad(
  setPacks: (packs: SessionPacksDraft) => void,
  setStatus: (status: Status) => void,
): void {
  useEffect(() => {
    let isCurrent = true;
    void loadSessionPacks().then((outcome) => {
      if (!isCurrent) {
        return;
      }
      if (outcome.kind === "failed") {
        setStatus({ ...outcome, phase: "load" });
        return;
      }
      setPacks(outcome.packs);
      setStatus({ kind: "editing" });
    });
    return () => {
      isCurrent = false;
    };
  }, [setPacks, setStatus]);
}

function useSessionPacksEditor(translate: Translator): SessionPacksEditor {
  const [packs, setPacks] = useState<SessionPacksDraft>(EMPTY_PACKS);
  const [status, setStatus] = useState<Status>({ kind: "loading" });
  const [notice, setNotice] = useState<string | null>(null);
  const [addIssue, setAddIssue] = useState<SessionPackIssueCode | null>(null);
  const [focusTarget, setFocusTarget] = useState<FocusTarget | null>(null);
  // Un doble clic llega antes de que el estado desactive el botón.
  const isSendingRef = useRef(false);
  useInitialLoad(setPacks, setStatus);

  function change(sizes: readonly number[], announcement: string): void {
    setPacks((current) => ({ ...current, sizes }));
    setNotice(announcement);
    setStatus({ kind: "editing" });
  }

  function move(sessions: number, direction: Direction): void {
    const sizes = swapWithNeighbour(packs.sizes, sessions, direction);
    const newIndex = sizes.indexOf(sessions);
    change(
      sizes,
      translate("clubSettings.sessionPacks.moved", {
        pack: packName(translate, sessions),
        rank: newIndex + 1,
        total: sizes.length,
      }),
    );
    setFocusTarget(focusAfterMove(sessions, newIndex, sizes.length, direction));
  }

  function remove(sessions: number): void {
    const index = packs.sizes.indexOf(sessions);
    const sizes = packs.sizes.filter((size) => size !== sessions);
    change(
      sizes,
      translate("clubSettings.sessionPacks.removed", {
        pack: packName(translate, sessions),
      }),
    );
    // El botón pulsado desaparece: el foco pasa al pack que ocupa su sitio,
    // o al anterior si era el último, o al campo de añadir si no queda
    // ninguno.
    const next = sizes[Math.min(index, sizes.length - 1)];
    setFocusTarget(
      next === undefined ? NEW_PACK_FIELD_ID : focusKey(next, "remove"),
    );
  }

  function add(sessions: number): boolean {
    const issue = findSessionPackIssue([...packs.sizes, sessions]);
    setAddIssue(issue);
    if (issue !== null) {
      return false;
    }
    change(
      [...packs.sizes, sessions],
      translate("clubSettings.sessionPacks.added", {
        pack: packName(translate, sessions),
      }),
    );
    return true;
  }

  async function submit(): Promise<void> {
    if (isSendingRef.current) {
      return;
    }
    const issue = findSessionPackIssue(packs.sizes);
    if (issue !== null) {
      setStatus({ kind: "invalid", code: issue });
      return;
    }
    isSendingRef.current = true;
    setStatus({ kind: "sending" });
    setNotice(null);
    const result = await saveSessionPacks(packs.sizes);
    isSendingRef.current = false;
    if (result.kind === "failed") {
      setStatus({ ...result, phase: "save" });
      return;
    }
    setPacks(result.packs);
    setStatus({ kind: "editing" });
    setNotice(translate("clubSettings.sessionPacks.saved"));
  }

  return {
    packs,
    status,
    notice,
    addIssue,
    focusTarget,
    move,
    remove,
    add,
    submit,
  };
}

function PackItem({
  translate,
  sessions,
  index,
  total,
  sessionPrice,
  isBusy,
  onMove,
  onRemove,
}: {
  translate: Translator;
  sessions: number;
  index: number;
  total: number;
  sessionPrice: ClubPrice;
  isBusy: boolean;
  onMove: (direction: Direction) => void;
  onRemove: () => void;
}): React.JSX.Element {
  const pack = packName(translate, sessions);
  const isAtEdge = (direction: Direction): boolean =>
    direction === "up" ? index === 0 : index === total - 1;
  const moveButton = (direction: Direction): React.JSX.Element => (
    <button
      type="button"
      className="admin-secondary"
      data-focus-key={focusKey(sessions, direction)}
      aria-label={translate(`clubSettings.sessionPacks.move.${direction}`, {
        pack,
      })}
      disabled={isBusy || isAtEdge(direction)}
      onClick={() => onMove(direction)}
    >
      {translate(`clubSettings.positions.move.${direction}`)}
    </button>
  );
  return (
    <li className="groups-item club-positions-item">
      <div className="club-positions-head">
        <span className="club-positions-rank" aria-hidden="true">
          {index + 1}
        </span>
        <div className="club-positions-names">
          <h3 className="club-positions-name">{pack}</h3>
          <p className="club-positions-note">
            {describePrice(translate, priceSessionPack(sessionPrice, sessions))}
          </p>
        </div>
      </div>
      <div className="groups-actions">
        {moveButton("up")}
        {moveButton("down")}
        <button
          type="button"
          className="admin-secondary"
          data-focus-key={focusKey(sessions, "remove")}
          aria-label={translate("clubSettings.sessionPacks.remove.label", {
            pack,
          })}
          disabled={isBusy}
          onClick={onRemove}
        >
          {translate("clubSettings.sessionPacks.remove")}
        </button>
      </div>
    </li>
  );
}

/** Un campo vacío o con algo que no es un número cuenta como fuera de rango:
 * así la pantalla dice el límite en vez de ignorar el clic. */
function parseSessions(text: string): number {
  const trimmed = text.trim();
  return trimmed === "" ? Number.NaN : Number(trimmed);
}

function AddPackForm({
  translate,
  issue,
  isBusy,
  onAdd,
}: {
  translate: Translator;
  issue: SessionPackIssueCode | null;
  isBusy: boolean;
  onAdd: (sessions: number) => boolean;
}): React.JSX.Element {
  const [text, setText] = useState("");
  const isInvalid = issue !== null;
  return (
    <form
      className="club-positions-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (onAdd(parseSessions(text))) {
          setText("");
        }
      }}
      noValidate
    >
      <div className="auth-field">
        <label htmlFor={NEW_PACK_FIELD_ID}>
          {translate("clubSettings.sessionPacks.add.label")}
        </label>
        <input
          id={NEW_PACK_FIELD_ID}
          data-focus-key={NEW_PACK_FIELD_ID}
          type="number"
          inputMode="numeric"
          min={MIN_PACK_SESSIONS}
          max={MAX_PACK_SESSIONS}
          step={1}
          value={text}
          aria-invalid={isInvalid}
          aria-describedby={
            isInvalid
              ? `${NEW_PACK_ISSUE_ID} ${NEW_PACK_HINT_ID}`
              : NEW_PACK_HINT_ID
          }
          onChange={(event) => setText(event.target.value)}
        />
        {isInvalid ? (
          <p className="auth-field-error" id={NEW_PACK_ISSUE_ID}>
            {describeSessionPackIssue(translate, issue)}
          </p>
        ) : null}
        <p className="auth-hint" id={NEW_PACK_HINT_ID}>
          {translate("clubSettings.sessionPacks.add.hint", {
            min: MIN_PACK_SESSIONS,
            max: MAX_PACK_SESSIONS,
          })}
        </p>
      </div>
      <button type="submit" className="admin-secondary" disabled={isBusy}>
        {translate("clubSettings.sessionPacks.add.submit")}
      </button>
    </form>
  );
}

function SaveError({
  translate,
  status,
}: {
  translate: Translator;
  status: Status;
}): React.JSX.Element | null {
  if (status.kind === "invalid") {
    return (
      <p className="auth-error" role="alert">
        {describeSessionPackIssue(translate, status.code)}
      </p>
    );
  }
  if (status.kind !== "failed" || status.phase !== "save") {
    return null;
  }
  return (
    <p className="auth-error" role="alert">
      {describeSessionPacksFailure(translate, status)}
    </p>
  );
}

/** Lleva el foco al botón que se pidió cuando la lista ya se pintó. */
function useFocusTarget(
  container: React.RefObject<HTMLElement | null>,
  target: FocusTarget | null,
): void {
  useEffect(() => {
    if (target === null) {
      return;
    }
    container.current
      ?.querySelector<HTMLElement>(`[data-focus-key="${target}"]`)
      ?.focus();
  }, [container, target]);
}

function SessionPacksEditorView({
  translate,
  editor,
}: {
  translate: Translator;
  editor: SessionPacksEditor;
}): React.JSX.Element {
  const { packs, status, notice, addIssue } = editor;
  const editorRef = useRef<HTMLDivElement>(null);
  useFocusTarget(editorRef, editor.focusTarget);
  const isSending = status.kind === "sending";
  return (
    <div className="club-session-packs" ref={editorRef}>
      <ol
        className="groups-list club-positions-list"
        aria-label={translate("clubSettings.sessionPacks.title")}
      >
        {packs.sizes.map((sessions, index) => (
          <PackItem
            key={sessions}
            translate={translate}
            sessions={sessions}
            index={index}
            total={packs.sizes.length}
            sessionPrice={packs.sessionPrice}
            isBusy={isSending}
            onMove={(direction) => editor.move(sessions, direction)}
            onRemove={() => editor.remove(sessions)}
          />
        ))}
      </ol>
      <AddPackForm
        translate={translate}
        issue={addIssue}
        isBusy={isSending}
        onAdd={editor.add}
      />
      {notice === null ? null : (
        <p className="auth-note" role="status">
          {notice}
        </p>
      )}
      <SaveError translate={translate} status={status} />
      <button
        type="button"
        className="auth-submit"
        disabled={isSending}
        onClick={() => void editor.submit()}
      >
        {translate(
          isSending
            ? "clubSettings.sessionPacks.saving"
            : "clubSettings.sessionPacks.save",
        )}
      </button>
    </div>
  );
}

export function ClubSessionPacksSection({
  translate,
}: {
  translate: Translator;
}): React.JSX.Element {
  const editor = useSessionPacksEditor(translate);
  const { status } = editor;
  const hasLoadFailed = status.kind === "failed" && status.phase === "load";

  return (
    <section className="auth-fields" aria-labelledby="club-packs-sesiones">
      <h2 id="club-packs-sesiones">
        {translate("clubSettings.sessionPacks.title")}
      </h2>
      <p className="app-lead">{translate("clubSettings.sessionPacks.lead")}</p>
      {status.kind === "loading" ? (
        <p className="admin-empty">
          {translate("clubSettings.sessionPacks.loading")}
        </p>
      ) : null}
      {hasLoadFailed ? (
        <p className="auth-error" role="alert">
          {describeSessionPacksFailure(translate, status)}
        </p>
      ) : null}
      {status.kind === "loading" || hasLoadFailed ? null : (
        <SessionPacksEditorView translate={translate} editor={editor} />
      )}
    </section>
  );
}
