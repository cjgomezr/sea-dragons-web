"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ApiRequestFailure } from "@/lib/api/request-api";
import {
  findSessionPackIssue,
  isSamePackList,
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
import { SavedNotice, UnsavedChangesBar } from "./ClubUnsavedChangesBar";
import {
  type ClubDraft,
  type ClubDraftStatus,
  type DraftSaveOutcome,
  useClubDraft,
} from "./use-club-draft";

/**
 * Los packs de sesiones que el club ofrece a sus Casual (#469, RF-4 del PRD
 * de E13). El Admin o el Committee añade, quita y ordena en un borrador, y lo
 * guarda entero con la barra de cambios sin guardar (#719): la API cambia la
 * lista de una vez.
 *
 * El precio de cada pack es el de una sesión Casual en Stripe por su tamaño.
 * Lo calcula la pantalla con el precio que trae el endpoint, así que un pack
 * recién añadido ya enseña el suyo antes de guardarse.
 */

type Direction = "up" | "down";

type LoadState =
  | { readonly kind: "loading" }
  | { readonly kind: "loaded" }
  | ApiRequestFailure;

type PackControl = Direction | "remove";

/** El `data-focus-key` del control que recibe el foco cuando la sección se
 * vuelve a pintar. */
type FocusTarget = string;

const NEW_PACK_FIELD_ID = "club-packs-nuevo";
const NEW_PACK_ISSUE_ID = `${NEW_PACK_FIELD_ID}-aviso`;
const NEW_PACK_HINT_ID = `${NEW_PACK_FIELD_ID}-ayuda`;
const NO_SESSION_PRICE: ClubPrice = {
  amountCents: null,
  reason: "not_configured",
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
  readonly sizes: readonly number[];
  readonly sessionPrice: ClubPrice;
  readonly load: LoadState;
  readonly status: ClubDraftStatus;
  readonly hasDraft: boolean;
  readonly isSavedNoticeShowing: boolean;
  readonly notice: string | null;
  readonly addIssue: SessionPackIssueCode | null;
  readonly focusTarget: FocusTarget | null;
  readonly move: (sessions: number, direction: Direction) => void;
  readonly remove: (sessions: number) => void;
  readonly add: (sessions: number) => boolean;
  readonly discard: () => void;
  readonly save: () => Promise<void>;
};

/** Lee lo guardado una vez, al montar. `keep` no cambia, así que el efecto
 * no se repite. */
function useInitialLoad(keep: (packs: SessionPacksDraft) => void): LoadState {
  const [load, setLoad] = useState<LoadState>({ kind: "loading" });
  useEffect(() => {
    let isCurrent = true;
    void loadSessionPacks().then((outcome) => {
      if (!isCurrent) {
        return;
      }
      if (outcome.kind === "failed") {
        setLoad(outcome);
        return;
      }
      keep(outcome.packs);
      setLoad({ kind: "loaded" });
    });
    return () => {
      isCurrent = false;
    };
  }, [keep]);
  return load;
}

/** La lista de packs como borrador, con el precio de una sesión que trae
 * cada respuesta del servidor. */
function usePacksDraft(onHasDraftChange: (hasDraft: boolean) => void): {
  readonly packs: ClubDraft<readonly number[]>;
  readonly sessionPrice: ClubPrice;
  readonly load: LoadState;
} {
  const [sessionPrice, setSessionPrice] = useState(NO_SESSION_PRICE);

  async function send(
    sizes: readonly number[],
  ): Promise<DraftSaveOutcome<readonly number[]>> {
    const result = await saveSessionPacks(sizes);
    if (result.kind === "failed") {
      return result;
    }
    setSessionPrice(result.packs.sessionPrice);
    return { kind: "saved", value: result.packs.sizes };
  }

  const packs = useClubDraft<readonly number[]>({
    initial: [],
    isSame: isSamePackList,
    send,
    onHasDraftChange,
  });
  const { replaceSaved } = packs;
  const keepLoaded = useCallback(
    (loaded: SessionPacksDraft): void => {
      setSessionPrice(loaded.sessionPrice);
      replaceSaved(loaded.sizes);
    },
    [replaceSaved],
  );
  const load = useInitialLoad(keepLoaded);
  return { packs, sessionPrice, load };
}

function useSessionPacksEditor(
  translate: Translator,
  onHasDraftChange: (hasDraft: boolean) => void,
): SessionPacksEditor {
  const { packs, sessionPrice, load } = usePacksDraft(onHasDraftChange);
  const [notice, setNotice] = useState<string | null>(null);
  const [addIssue, setAddIssue] = useState<SessionPackIssueCode | null>(null);
  const [focusTarget, setFocusTarget] = useState<FocusTarget | null>(null);
  const sizes = packs.draft;

  function change(next: readonly number[], announcement: string): void {
    packs.change(() => next);
    setNotice(announcement);
  }

  function move(sessions: number, direction: Direction): void {
    const moved = swapWithNeighbour(sizes, sessions, direction);
    const newIndex = moved.indexOf(sessions);
    change(
      moved,
      translate("clubSettings.sessionPacks.moved", {
        pack: packName(translate, sessions),
        rank: newIndex + 1,
        total: moved.length,
      }),
    );
    setFocusTarget(focusAfterMove(sessions, newIndex, moved.length, direction));
  }

  function remove(sessions: number): void {
    const index = sizes.indexOf(sessions);
    const left = sizes.filter((size) => size !== sessions);
    change(
      left,
      translate("clubSettings.sessionPacks.removed", {
        pack: packName(translate, sessions),
      }),
    );
    // El botón pulsado desaparece: el foco pasa al pack que ocupa su sitio,
    // o al anterior si era el último, o al campo de añadir si no queda
    // ninguno.
    const next = left[Math.min(index, left.length - 1)];
    setFocusTarget(
      next === undefined ? NEW_PACK_FIELD_ID : focusKey(next, "remove"),
    );
  }

  function add(sessions: number): boolean {
    const issue = findSessionPackIssue([...sizes, sessions]);
    setAddIssue(issue);
    if (issue !== null) {
      return false;
    }
    change(
      [...sizes, sessions],
      translate("clubSettings.sessionPacks.added", {
        pack: packName(translate, sessions),
      }),
    );
    return true;
  }

  function discard(): void {
    packs.discard();
    setNotice(null);
  }

  async function save(): Promise<void> {
    setNotice(null);
    await packs.save();
  }

  return {
    sizes,
    sessionPrice,
    load,
    status: packs.status,
    hasDraft: packs.hasDraft,
    isSavedNoticeShowing: packs.isSavedNoticeShowing,
    notice,
    addIssue,
    focusTarget,
    move,
    remove,
    add,
    discard,
    save,
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

/** Lo que impide guardar: una lista inválida (sin ningún pack) o el error
 * del último guardado. */
function SaveError({
  translate,
  listIssue,
  status,
}: {
  translate: Translator;
  listIssue: SessionPackIssueCode | null;
  status: ClubDraftStatus;
}): React.JSX.Element | null {
  if (listIssue !== null) {
    return (
      <p className="auth-error" role="alert">
        {describeSessionPackIssue(translate, listIssue)}
      </p>
    );
  }
  if (status.kind !== "failed") {
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
  const { sizes, status, notice, addIssue } = editor;
  const editorRef = useRef<HTMLDivElement>(null);
  useFocusTarget(editorRef, editor.focusTarget);
  const isSending = status.kind === "sending";
  const listIssue = editor.hasDraft ? findSessionPackIssue(sizes) : null;
  return (
    <div className="club-session-packs" ref={editorRef}>
      <ol
        className="groups-items"
        aria-label={translate("clubSettings.sessionPacks.title")}
      >
        {sizes.map((sessions, index) => (
          <PackItem
            key={sessions}
            translate={translate}
            sessions={sessions}
            index={index}
            total={sizes.length}
            sessionPrice={editor.sessionPrice}
            isBusy={isSending}
            onMove={(direction) => editor.move(sessions, direction)}
            onRemove={() => editor.remove(sessions)}
          />
        ))}
      </ol>
      <div className="club-positions-group">
        <h3>{translate("clubSettings.sessionPacks.add.title")}</h3>
        <AddPackForm
          translate={translate}
          issue={addIssue}
          isBusy={isSending}
          onAdd={editor.add}
        />
      </div>
      {notice === null ? null : (
        <p className="auth-note" role="status">
          {notice}
        </p>
      )}
      <SaveError translate={translate} listIssue={listIssue} status={status} />
      {editor.hasDraft ? (
        <UnsavedChangesBar
          translate={translate}
          section="packs"
          headingId="club-packs-sesiones"
          canSave={listIssue === null}
          isSaving={isSending}
          onDiscard={editor.discard}
          onSave={() => void editor.save()}
        />
      ) : null}
      <SavedNotice
        translate={translate}
        isShowing={editor.isSavedNoticeShowing}
      />
    </div>
  );
}

export function ClubSessionPacksSection({
  translate,
  onHasDraftChange,
}: {
  translate: Translator;
  onHasDraftChange: (hasDraft: boolean) => void;
}): React.JSX.Element {
  const editor = useSessionPacksEditor(translate, onHasDraftChange);
  const { load } = editor;

  return (
    <section className="auth-fields" aria-labelledby="club-packs-sesiones">
      <h2 id="club-packs-sesiones" tabIndex={-1}>
        {translate("clubSettings.sessionPacks.title")}
      </h2>
      <p className="auth-hint">{translate("clubSettings.sessionPacks.lead")}</p>
      {load.kind === "loading" ? (
        <p className="admin-empty">
          {translate("clubSettings.sessionPacks.loading")}
        </p>
      ) : null}
      {load.kind === "failed" ? (
        <p className="auth-error" role="alert">
          {describeSessionPacksFailure(translate, load)}
        </p>
      ) : null}
      {load.kind === "loaded" ? (
        <SessionPacksEditorView translate={translate} editor={editor} />
      ) : null}
    </section>
  );
}
