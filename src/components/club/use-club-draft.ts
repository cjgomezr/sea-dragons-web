"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ApiRequestFailure } from "@/lib/api/request-api";

/**
 * El borrador de una sección de la configuración del club que se guarda con
 * la barra de cambios sin guardar (#719, RF-2 y D10 del PRD de E26):
 * General, Inicio de sesión y Packs. Cada sección pone lo suyo (qué manda,
 * cómo compara y qué valida); esto es lo común: si hay borrador, guardarlo
 * una sola vez, conservarlo si falla, descartarlo y el aviso de guardado.
 */

/** Cuánto se ve "✓ Guardado" tras guardar, como en el prototipo. */
export const SAVED_NOTICE_DURATION_MS = 2500;

export type DraftSaveOutcome<Value> =
  { readonly kind: "saved"; readonly value: Value } | ApiRequestFailure;

export type ClubDraftStatus =
  { readonly kind: "idle" } | { readonly kind: "sending" } | ApiRequestFailure;

export type ClubDraft<Value> = {
  readonly draft: Value;
  readonly saved: Value;
  readonly status: ClubDraftStatus;
  readonly hasDraft: boolean;
  readonly isSavedNoticeShowing: boolean;
  readonly change: (update: (current: Value) => Value) => void;
  readonly discard: () => void;
  /** Lo que se acaba de cargar pasa a ser lo guardado, sin borrador. */
  readonly replaceSaved: (value: Value) => void;
  readonly save: () => Promise<void>;
};

const IDLE: ClubDraftStatus = { kind: "idle" };

/** Le dice a la pantalla si hay borrador, para el punto de la pestaña y la
 * pregunta al salir. Una sección que se desmonta ya no tiene borrador. */
function useReportDraft(
  hasDraft: boolean,
  onHasDraftChange: (hasDraft: boolean) => void,
): void {
  useEffect(() => {
    onHasDraftChange(hasDraft);
  }, [hasDraft, onHasDraftChange]);
  useEffect(() => () => onHasDraftChange(false), [onHasDraftChange]);
}

function useSavedNotice(): readonly [boolean, (isShowing: boolean) => void] {
  const [isShowing, setIsShowing] = useState(false);
  useEffect(() => {
    if (!isShowing) {
      return;
    }
    const timer = window.setTimeout(
      () => setIsShowing(false),
      SAVED_NOTICE_DURATION_MS,
    );
    return () => window.clearTimeout(timer);
  }, [isShowing]);
  return [isShowing, setIsShowing];
}

export function useClubDraft<Value>({
  initial,
  isSame,
  send,
  onHasDraftChange,
}: {
  readonly initial: Value;
  readonly isSame: (draft: Value, saved: Value) => boolean;
  /** Manda el borrador; `saved` es lo que había, para quien lo necesite
   * (el 409 de General). */
  readonly send: (
    draft: Value,
    saved: Value,
  ) => Promise<DraftSaveOutcome<Value>>;
  readonly onHasDraftChange: (hasDraft: boolean) => void;
}): ClubDraft<Value> {
  const [saved, setSaved] = useState(initial);
  const [draft, setDraft] = useState(initial);
  const [status, setStatus] = useState<ClubDraftStatus>(IDLE);
  const [isSavedNoticeShowing, setIsSavedNoticeShowing] = useSavedNotice();
  // El estado desactiva los botones en el siguiente pintado, pero un doble
  // clic llega antes. La referencia cambia en el acto.
  const isSendingRef = useRef(false);
  const hasDraft = !isSame(draft, saved);
  useReportDraft(hasDraft, onHasDraftChange);

  function change(update: (current: Value) => Value): void {
    setDraft(update);
    setStatus((current) => (current.kind === "sending" ? current : IDLE));
    setIsSavedNoticeShowing(false);
  }

  function discard(): void {
    setDraft(saved);
    setStatus(IDLE);
  }

  // Estable: la sección la llama desde el efecto de su carga.
  const replaceSaved = useCallback((value: Value): void => {
    setSaved(value);
    setDraft(value);
  }, []);

  async function save(): Promise<void> {
    if (isSendingRef.current) {
      return;
    }
    isSendingRef.current = true;
    setStatus({ kind: "sending" });
    const outcome = await send(draft, saved);
    isSendingRef.current = false;
    if (outcome.kind === "failed") {
      setStatus(outcome);
      return;
    }
    replaceSaved(outcome.value);
    setStatus(IDLE);
    setIsSavedNoticeShowing(true);
  }

  return {
    draft,
    saved,
    status,
    hasDraft,
    isSavedNoticeShowing,
    change,
    discard,
    replaceSaved,
    save,
  };
}
