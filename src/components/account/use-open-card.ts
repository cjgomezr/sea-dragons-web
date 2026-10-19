"use client";

import { useRef, useState } from "react";

/**
 * Qué tarjeta de una pantalla está abierta (#772, D5 del PRD de E30): una a
 * la vez. Abrir otra cierra la que había; si tenía cambios sin guardar, antes
 * se pregunta, como en el resto de la aplicación, con el diálogo del
 * navegador. La tarjeta abierta dice si tiene cambios cada vez que se edita, y
 * se guarda en una referencia porque sólo hace falta al abrir otra.
 *
 * Recuerda además cuál se acaba de guardar, para que su aviso salga hasta que
 * se abra cualquier tarjeta.
 */

export type CardRequest<Card extends string> = {
  readonly card: Card;
  /** El campo que recibe el foco al abrirse. */
  readonly focusFieldId: string;
};

export type OpenCardState<Card extends string> = {
  readonly open: CardRequest<Card> | null;
  readonly savedCard: Card | null;
  readonly openCard: (request: CardRequest<Card>) => void;
  readonly closeCard: () => void;
  /** Cierra la que guardó, si sigue abierta: mientras guardaba se pudo abrir
   * otra, y esa no se toca. */
  readonly closeSavedCard: (card: Card) => void;
  readonly reportChanges: (hasChanges: boolean) => void;
};

export function focusFieldById(id: string): void {
  const field = document.getElementById(id);
  if (field === null) {
    throw new Error(`Falta el campo ${id} de la tarjeta.`);
  }
  field.focus();
}

export function useOpenCard<Card extends string>(
  discardQuestion: string,
): OpenCardState<Card> {
  const [open, setOpen] = useState<CardRequest<Card> | null>(null);
  const [savedCard, setSavedCard] = useState<Card | null>(null);
  const hasChangesRef = useRef(false);
  // Un guardado vuelve con las funciones del pintado en que se pidió: la
  // referencia dice qué tarjeta está abierta ahora.
  const openCardRef = useRef<Card | null>(null);

  function changeOpen(request: CardRequest<Card> | null): void {
    hasChangesRef.current = false;
    openCardRef.current = request === null ? null : request.card;
    setOpen(request);
  }

  function openCard(request: CardRequest<Card>): void {
    if (open !== null && open.card === request.card) {
      focusFieldById(request.focusFieldId);
      return;
    }
    if (
      open !== null &&
      hasChangesRef.current &&
      !window.confirm(discardQuestion)
    ) {
      return;
    }
    setSavedCard(null);
    changeOpen(request);
  }

  function closeCard(): void {
    changeOpen(null);
  }

  function closeSavedCard(card: Card): void {
    if (openCardRef.current !== card) {
      return;
    }
    changeOpen(null);
    setSavedCard(card);
  }

  function reportChanges(hasChanges: boolean): void {
    hasChangesRef.current = hasChanges;
  }

  return {
    open,
    savedCard,
    openCard,
    closeCard,
    closeSavedCard,
    reportChanges,
  };
}
