"use client";

import { ArrowCounterClockwise } from "@phosphor-icons/react/dist/ssr/ArrowCounterClockwise";
import { DotsThreeVertical } from "@phosphor-icons/react/dist/ssr/DotsThreeVertical";
import { EyeSlash } from "@phosphor-icons/react/dist/ssr/EyeSlash";
import { PencilSimple } from "@phosphor-icons/react/dist/ssr/PencilSimple";
import { PushPin } from "@phosphor-icons/react/dist/ssr/PushPin";
import { PushPinSlash } from "@phosphor-icons/react/dist/ssr/PushPinSlash";
import { WarningCircle } from "@phosphor-icons/react/dist/ssr/WarningCircle";
import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { BottomSheet } from "@/components/directory/BottomSheet";
import { Icon } from "@/components/Icon";
import { NEWS_EDIT_PATH } from "@/lib/auth/routes";
import type { Translator } from "@/lib/i18n/translator";
import { NEWS_PIN_DURATIONS } from "@/lib/news/news-pin-duration";
import type { NewsPostDetail } from "@/lib/news/news-posts";
import {
  changeStatusFromSheet,
  pinFromSheet,
  unpinFromSheet,
  useReplacesPinned,
  useSheetRequest,
} from "./news-post-sheet-actions";
import { WithdrawConfirmation } from "./NewsPostActions";

/**
 * El ⋯ de la barra de la publicación en el móvil (#601, "#2d" del handoff de
 * E22) y la hoja que sube: Editar publicación y Retirar a quien la gestiona
 * (`canManage`), Fijar arriba o Desfijar sólo al Admin (D1), y Cancelar.
 * Fijar arriba cambia la hoja por las duraciones; Retirar, por la misma
 * confirmación que en escritorio. Al cerrarse, por donde sea, el foco vuelve
 * al ⋯.
 */

type SheetStep = "menu" | "choosingDuration" | "confirmingWithdrawal";

type ChangedHandler = (post: NewsPostDetail, announcement: string) => void;

const MENU_STEP: SheetStep = "menu";

/** Una fila de la hoja: el icono, su título y, si la lleva, la pista de
 * debajo como descripción. */
function SheetRow({
  glyph,
  title,
  hint,
  isDanger = false,
  isDisabled,
  onChoose,
}: {
  readonly glyph: Parameters<typeof Icon>[0]["glyph"];
  readonly title: string;
  readonly hint?: string;
  readonly isDanger?: boolean;
  readonly isDisabled: boolean;
  readonly onChoose: () => void;
}): React.JSX.Element {
  const titleId = useId();
  const hintId = useId();
  return (
    <button
      type="button"
      className={
        isDanger
          ? "news-sheet-action news-sheet-action-danger"
          : "news-sheet-action"
      }
      aria-labelledby={titleId}
      aria-describedby={hint === undefined ? undefined : hintId}
      disabled={isDisabled}
      onClick={onChoose}
    >
      <Icon glyph={glyph} />
      <span className="news-sheet-action-text">
        <span id={titleId}>{title}</span>
        {hint === undefined ? null : (
          <span id={hintId} className="news-sheet-action-hint">
            {hint}
          </span>
        )}
      </span>
    </button>
  );
}

function SheetMenu({
  translate,
  post,
  isSending,
  onPin,
  onUnpin,
  onWithdraw,
  onRepublish,
}: {
  readonly translate: Translator;
  readonly post: NewsPostDetail;
  readonly isSending: boolean;
  readonly onPin: () => void;
  readonly onUnpin: () => void;
  readonly onWithdraw: () => void;
  readonly onRepublish: () => void;
}): React.JSX.Element {
  const isWithdrawn = post.status === "withdrawn";
  return (
    <>
      {post.canManage ? (
        <Link
          href={NEWS_EDIT_PATH.replace("[id]", encodeURIComponent(post.id))}
          className="news-sheet-action"
        >
          <Icon glyph={PencilSimple} />
          <span className="news-sheet-action-text">
            {translate("news.post.sheet.edit")}
          </span>
        </Link>
      ) : null}
      {post.canPin && !post.isPinned ? (
        <SheetRow
          glyph={PushPin}
          title={translate("news.post.sheet.pin")}
          hint={translate("news.post.sheet.pinHint")}
          isDisabled={isSending}
          onChoose={onPin}
        />
      ) : null}
      {post.canPin && post.isPinned ? (
        <SheetRow
          glyph={PushPinSlash}
          title={translate("news.pin.unpin")}
          isDisabled={isSending}
          onChoose={onUnpin}
        />
      ) : null}
      {post.canManage && isWithdrawn ? (
        <SheetRow
          glyph={ArrowCounterClockwise}
          title={translate(
            isSending ? "news.post.republishing" : "news.post.republish",
          )}
          isDisabled={isSending}
          onChoose={onRepublish}
        />
      ) : null}
      {post.canManage && !isWithdrawn ? (
        <SheetRow
          glyph={EyeSlash}
          title={translate("news.post.withdraw")}
          isDanger
          isDisabled={isSending}
          onChoose={onWithdraw}
        />
      ) : null}
    </>
  );
}

/** Las cuatro duraciones. Mientras se guarda se marcan desactivadas sin
 * `disabled`, como en la tira del feed, para que el foco no se pierda si el
 * servidor dice que no; lo que impide la segunda petición es
 * `useSheetRequest`. */
function SheetDurations({
  translate,
  replacesPinned,
  isSending,
  onChoose,
}: {
  readonly translate: Translator;
  readonly replacesPinned: boolean;
  readonly isSending: boolean;
  readonly onChoose: (duration: (typeof NEWS_PIN_DURATIONS)[number]) => void;
}): React.JSX.Element {
  const labelId = useId();
  return (
    <>
      <p id={labelId} className="directory-sheet-label">
        {translate("news.pin.stripLabel")}
      </p>
      <div
        className="news-sheet-durations"
        role="group"
        aria-labelledby={labelId}
      >
        {NEWS_PIN_DURATIONS.map((duration) => (
          <button
            key={duration}
            type="button"
            className="directory-sheet-option"
            aria-disabled={isSending}
            onClick={() => onChoose(duration)}
          >
            {translate(`news.pin.duration.${duration}`)}
          </button>
        ))}
      </div>
      {replacesPinned ? (
        <p className="news-pin-strip-warning">
          <Icon glyph={WarningCircle} />
          {translate("news.pin.replaces")}
        </p>
      ) : null}
    </>
  );
}

function SheetContent({
  translate,
  post,
  onChanged,
  close,
}: {
  readonly translate: Translator;
  readonly post: NewsPostDetail;
  readonly onChanged: ChangedHandler;
  readonly close: () => void;
}): React.JSX.Element {
  const [step, setStep] = useState<SheetStep>(MENU_STEP);
  const { isSending, failure, run } = useSheetRequest({
    onDone: onChanged,
    close,
  });
  const replacesPinned = useReplacesPinned(post);
  const stepRef = useRef<HTMLDivElement>(null);
  const hasChangedStep = useRef(false);

  // El botón que cambió de paso desaparece con él: el foco pasa al paso
  // nuevo para no quedarse en el aire.
  useEffect(() => {
    if (hasChangedStep.current) {
      stepRef.current?.focus();
    }
  }, [step]);

  function goTo(next: SheetStep): void {
    hasChangedStep.current = true;
    setStep(next);
  }

  return (
    <>
      <div ref={stepRef} className="news-sheet-step" tabIndex={-1}>
        {step === "menu" ? (
          <SheetMenu
            translate={translate}
            post={post}
            isSending={isSending}
            onPin={() => goTo("choosingDuration")}
            onUnpin={() => void run(() => unpinFromSheet(translate, post))}
            onWithdraw={() => goTo("confirmingWithdrawal")}
            onRepublish={() =>
              void run(() =>
                changeStatusFromSheet(translate, post, "published"),
              )
            }
          />
        ) : null}
        {step === "choosingDuration" ? (
          <SheetDurations
            translate={translate}
            replacesPinned={replacesPinned}
            isSending={isSending}
            onChoose={(duration) =>
              void run(() => pinFromSheet(translate, post, duration))
            }
          />
        ) : null}
        {step === "confirmingWithdrawal" ? (
          <WithdrawConfirmation
            translate={translate}
            isSending={isSending}
            onConfirm={() =>
              void run(() =>
                changeStatusFromSheet(translate, post, "withdrawn"),
              )
            }
            onCancel={() => goTo(MENU_STEP)}
          />
        ) : null}
      </div>
      {failure === null ? null : (
        <p className="auth-error" role="alert">
          {failure}
        </p>
      )}
      {step === "confirmingWithdrawal" ? null : (
        <button
          type="button"
          className="admin-secondary directory-sheet-cancel"
          onClick={close}
        >
          {translate("news.post.cancel")}
        </button>
      )}
    </>
  );
}

export function NewsPostMoreActions({
  translate,
  post,
  onChanged,
}: {
  readonly translate: Translator;
  readonly post: NewsPostDetail;
  readonly onChanged: ChangedHandler;
}): React.JSX.Element {
  const [isOpen, setIsOpen] = useState(false);
  const openerRef = useRef<HTMLButtonElement>(null);
  const label = translate("news.post.bar.more");

  function closeSheet(): void {
    setIsOpen(false);
    openerRef.current?.focus();
  }

  return (
    <>
      <button
        ref={openerRef}
        type="button"
        className="news-post-bar-button"
        aria-label={label}
        title={label}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        onClick={() => setIsOpen(true)}
      >
        <Icon glyph={DotsThreeVertical} />
      </button>
      {isOpen ? (
        <BottomSheet
          title={(titleId) => (
            <h2 id={titleId} className="visually-hidden">
              {translate("news.post.sheet.title")}
            </h2>
          )}
          gripLabel={translate("news.post.sheet.close")}
          onClosed={closeSheet}
        >
          {(close) => (
            <SheetContent
              translate={translate}
              post={post}
              onChanged={onChanged}
              close={close}
            />
          )}
        </BottomSheet>
      ) : null}
    </>
  );
}
