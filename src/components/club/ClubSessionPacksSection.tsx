"use client";

import { DotsSixVertical } from "@phosphor-icons/react/dist/ssr/DotsSixVertical";
import { Plus } from "@phosphor-icons/react/dist/ssr/Plus";
import { Trash } from "@phosphor-icons/react/dist/ssr/Trash";
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
 * de E13), en la tabla de #722 (RF-7 del PRD de E26). El Admin o el
 * Committee añade, quita y ordena en un borrador, y lo guarda entero con la
 * barra de cambios sin guardar (#719): la API cambia la lista de una vez.
 *
 * El precio de cada pack es el de una sesión Casual en Stripe por su tamaño.
 * Lo calcula la pantalla con el precio que trae el endpoint, así que un pack
 * que se está escribiendo ya enseña el suyo antes de añadirse.
 */

type Direction = "up" | "down";

type LoadState =
  | { readonly kind: "loading" }
  | { readonly kind: "loaded" }
  | ApiRequestFailure;

type PackControl = "handle" | "remove";

/** El `data-focus-key` del control que recibe el foco cuando la sección se
 * vuelve a pintar. Un objeto nuevo en cada petición: mover dos veces el
 * mismo pack pide el mismo control, y el efecto tiene que repetirse. */
type FocusTarget = { readonly key: string };

/** Lo que dice la fila de añadir mientras el número no vale. */
const NO_LIVE_PRICE = "–";

const MOVE_KEYS: Readonly<Record<string, Direction>> = {
  ArrowUp: "up",
  ArrowDown: "down",
};

const NEW_PACK_FIELD_ID = "club-packs-nuevo";
const NEW_PACK_ISSUE_ID = `${NEW_PACK_FIELD_ID}-aviso`;
const NEW_PACK_PRICE_ID = `${NEW_PACK_FIELD_ID}-precio`;
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

function focusKey(sessions: number, control: PackControl): string {
  return `pack-${sessions}-${control}`;
}

/** El aviso de la fila de añadir, más corto que el de la lista entera: se
 * lee junto al número que se escribió. */
function describeNewPackIssue(
  translate: Translator,
  issue: SessionPackIssueCode,
): string {
  switch (issue) {
    case "pack_sessions_out_of_range":
      return translate("clubSettings.sessionPacks.add.issue.outOfRange", {
        min: MIN_PACK_SESSIONS,
        max: MAX_PACK_SESSIONS,
      });
    case "pack_sessions_repeated":
      return translate("clubSettings.sessionPacks.add.issue.repeated");
    case "packs_required":
      return describeSessionPackIssue(translate, issue);
  }
}

/** La lista con el pack de `sessions` cambiado de sitio con su vecino, o
 * nulo si ya está en ese extremo. */
function swapWithNeighbour(
  sizes: readonly number[],
  sessions: number,
  direction: Direction,
): readonly number[] | null {
  const index = sizes.indexOf(sessions);
  const neighbourIndex = direction === "up" ? index - 1 : index + 1;
  const neighbour = sizes[neighbourIndex];
  if (index === -1 || neighbour === undefined) {
    return null;
  }
  return sizes.map((size, position) => {
    if (position === index) {
      return neighbour;
    }
    return position === neighbourIndex ? sessions : size;
  });
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
  readonly clearAddIssue: () => void;
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
    if (moved === null) {
      return;
    }
    change(
      moved,
      translate("clubSettings.sessionPacks.moved", {
        pack: packName(translate, sessions),
        rank: moved.indexOf(sessions) + 1,
        total: moved.length,
      }),
    );
    setFocusTarget({ key: focusKey(sessions, "handle") });
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
    // o a la fila de añadir si era el último.
    const next = left[index];
    setFocusTarget({
      key: next === undefined ? NEW_PACK_FIELD_ID : focusKey(next, "remove"),
    });
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

  function clearAddIssue(): void {
    setAddIssue(null);
  }

  function discard(): void {
    packs.discard();
    setNotice(null);
    clearAddIssue();
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
    clearAddIssue,
    discard,
    save,
  };
}

function PackRow({
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
  return (
    <li className="club-packs-row">
      <button
        type="button"
        className="club-packs-handle"
        data-focus-key={focusKey(sessions, "handle")}
        aria-label={translate("clubSettings.sessionPacks.handle", {
          pack,
          rank: index + 1,
          total,
        })}
        disabled={isBusy}
        onKeyDown={(event) => {
          const direction = MOVE_KEYS[event.key];
          if (direction === undefined) {
            return;
          }
          event.preventDefault();
          onMove(direction);
        }}
      >
        <DotsSixVertical aria-hidden="true" weight="bold" />
      </button>
      <span className="club-packs-label">
        <span className="club-packs-badge" aria-hidden="true">
          {sessions}
        </span>
        <span className="club-packs-name">{pack}</span>
      </span>
      <span className="club-packs-price">
        {describePrice(translate, priceSessionPack(sessionPrice, sessions))}
      </span>
      <button
        type="button"
        className="club-packs-remove"
        data-focus-key={focusKey(sessions, "remove")}
        aria-label={translate("clubSettings.sessionPacks.remove.label", {
          pack,
        })}
        disabled={isBusy}
        onClick={onRemove}
      >
        <Trash aria-hidden="true" />
      </button>
    </li>
  );
}

/** Un campo vacío o con algo que no es un número cuenta como fuera de rango:
 * así la pantalla dice el límite en vez de ignorar el clic. */
function parseSessions(text: string): number {
  const trimmed = text.trim();
  return trimmed === "" ? Number.NaN : Number(trimmed);
}

/** El precio del pack que se está escribiendo, o una raya si el número no
 * vale como pack. */
function describeLivePrice(
  translate: Translator,
  sessionPrice: ClubPrice,
  text: string,
): string {
  const sessions = parseSessions(text);
  if (findSessionPackIssue([sessions]) !== null) {
    return NO_LIVE_PRICE;
  }
  return describePrice(translate, priceSessionPack(sessionPrice, sessions));
}

function AddPackRow({
  translate,
  sessionPrice,
  issue,
  isBusy,
  onAdd,
  onEdit,
}: {
  translate: Translator;
  sessionPrice: ClubPrice;
  issue: SessionPackIssueCode | null;
  isBusy: boolean;
  onAdd: (sessions: number) => boolean;
  /** Un número nuevo deja viejo el aviso del anterior. */
  onEdit: () => void;
}): React.JSX.Element {
  const [text, setText] = useState("");
  const isInvalid = issue !== null;
  return (
    <form
      className="club-packs-add"
      onSubmit={(event) => {
        event.preventDefault();
        if (onAdd(parseSessions(text))) {
          setText("");
        }
      }}
      noValidate
    >
      <Plus className="club-packs-add-icon" aria-hidden="true" />
      <span className="club-packs-add-field">
        <label htmlFor={NEW_PACK_FIELD_ID} className="visually-hidden">
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
          placeholder={translate("clubSettings.sessionPacks.add.placeholder")}
          value={text}
          aria-invalid={isInvalid}
          aria-describedby={
            isInvalid
              ? `${NEW_PACK_ISSUE_ID} ${NEW_PACK_PRICE_ID}`
              : NEW_PACK_PRICE_ID
          }
          onChange={(event) => {
            setText(event.target.value);
            onEdit();
          }}
        />
        <span className="club-packs-add-unit" aria-hidden="true">
          {translate("clubSettings.sessionPacks.add.unit")}
        </span>
      </span>
      <span className="club-packs-price" id={NEW_PACK_PRICE_ID}>
        {describeLivePrice(translate, sessionPrice, text)}
      </span>
      <button type="submit" className="club-packs-add-submit" disabled={isBusy}>
        <Plus className="club-packs-add-submit-icon" aria-hidden="true" />
        <span className="club-packs-add-submit-text">
          {translate("clubSettings.sessionPacks.add.submit")}
        </span>
      </button>
      {isInvalid ? (
        <p className="club-packs-add-issue" id={NEW_PACK_ISSUE_ID}>
          {describeNewPackIssue(translate, issue)}
        </p>
      ) : null}
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

/** Lleva el foco al control que se pidió cuando la tabla ya se pintó. */
function useFocusTarget(
  container: React.RefObject<HTMLElement | null>,
  target: FocusTarget | null,
): void {
  useEffect(() => {
    if (target === null) {
      return;
    }
    container.current
      ?.querySelector<HTMLElement>(`[data-focus-key="${target.key}"]`)
      ?.focus();
  }, [container, target]);
}

function PacksTable({
  translate,
  editor,
}: {
  translate: Translator;
  editor: SessionPacksEditor;
}): React.JSX.Element {
  const { sizes } = editor;
  const isSending = editor.status.kind === "sending";
  return (
    <div className="club-packs-table">
      {sizes.length === 0 ? (
        <p className="club-packs-empty">
          {translate("clubSettings.sessionPacks.empty")}
        </p>
      ) : (
        <ol
          className="club-packs-list"
          aria-label={translate("clubSettings.sessionPacks.title")}
        >
          {sizes.map((sessions, index) => (
            <PackRow
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
      )}
      <AddPackRow
        translate={translate}
        sessionPrice={editor.sessionPrice}
        issue={editor.addIssue}
        isBusy={isSending}
        onAdd={editor.add}
        onEdit={editor.clearAddIssue}
      />
    </div>
  );
}

function SessionPacksEditorView({
  translate,
  editor,
}: {
  translate: Translator;
  editor: SessionPacksEditor;
}): React.JSX.Element {
  const { status, notice } = editor;
  const editorRef = useRef<HTMLDivElement>(null);
  useFocusTarget(editorRef, editor.focusTarget);
  const isSending = status.kind === "sending";
  const listIssue = editor.hasDraft ? findSessionPackIssue(editor.sizes) : null;
  return (
    <div className="club-session-packs" ref={editorRef}>
      <PacksTable translate={translate} editor={editor} />
      <p className="auth-hint">
        {translate("clubSettings.sessionPacks.footer", {
          min: MIN_PACK_SESSIONS,
          max: MAX_PACK_SESSIONS,
        })}
      </p>
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

/** La entrada con el precio de una sesión, si Stripe lo da. */
function describeLead(translate: Translator, sessionPrice: ClubPrice): string {
  if (sessionPrice.amountCents === null) {
    return translate("clubSettings.sessionPacks.lead.noPrice");
  }
  return translate("clubSettings.sessionPacks.lead", {
    price: formatAudCents(translate.locale, sessionPrice.amountCents),
  });
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
    <section
      className="auth-fields club-packs-section"
      aria-labelledby="club-packs-sesiones"
    >
      <h2 id="club-packs-sesiones" tabIndex={-1}>
        {translate("clubSettings.sessionPacks.title")}
      </h2>
      <p className="auth-hint">
        {describeLead(translate, editor.sessionPrice)}
      </p>
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
