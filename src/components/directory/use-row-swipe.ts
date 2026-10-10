"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Deslizar una fila del directorio en el móvil (#554, "2b", punto 1): a la
 * izquierda enseña sus acciones, a la derecha las esconde, y sólo una fila
 * las tiene abiertas a la vez. Tocar fuera de esas acciones las cierra.
 *
 * Son eventos de puntero, y la hoja de estilos pone `touch-action: pan-y` en
 * la fila: un movimiento en vertical es del navegador, que desplaza la lista,
 * y la fila no lo toma por un gesto. El clic que llega después de deslizar no
 * es un toque: no sube la ficha.
 */

/** Lo que tiene que recorrer el dedo en horizontal para que cuente. */
const SWIPE_THRESHOLD_PX = 30;

/** Lo que lleva las acciones de la fila (`SwipeActionsCell`): un toque
 * dentro no las cierra. */
const SWIPE_ACTIONS_SELECTOR = "[data-swipe-actions]";

export type RowSwipe = {
  readonly isOpen: boolean;
  /** Si alguna fila, ésta u otra, tiene sus acciones abiertas. */
  readonly isAnyOpen: boolean;
  readonly open: () => void;
  readonly close: () => void;
};

/** La fila que tiene sus acciones abiertas, una como mucho. Una que ya no
 * está en la lista (otro filtro la dejó fuera) no cuenta como abierta: si
 * no, el siguiente toque se gastaría en cerrar unas acciones que no se ven. */
export function useOpenSwipeRow(listedUserIds: readonly string[]): {
  readonly swipeOf: (userId: string) => RowSwipe;
} {
  const [swipedUserId, setSwipedUserId] = useState<string | null>(null);
  const openUserId =
    swipedUserId !== null && listedUserIds.includes(swipedUserId)
      ? swipedUserId
      : null;

  useEffect(() => {
    if (openUserId === null) {
      return;
    }
    function closeOnPressOutside(event: PointerEvent): void {
      const isInsideActions =
        event.target instanceof Element &&
        event.target.closest(SWIPE_ACTIONS_SELECTOR) !== null;
      if (!isInsideActions) {
        setSwipedUserId(null);
      }
    }
    document.addEventListener("pointerdown", closeOnPressOutside);
    return () =>
      document.removeEventListener("pointerdown", closeOnPressOutside);
  }, [openUserId]);

  function swipeOf(userId: string): RowSwipe {
    return {
      isOpen: openUserId === userId,
      isAnyOpen: openUserId !== null,
      open: () => setSwipedUserId(userId),
      close: () =>
        setSwipedUserId((current) => (current === userId ? null : current)),
    };
  }

  return { swipeOf };
}

type Point = { readonly x: number; readonly y: number };

export type SwipeHandlers = {
  readonly onPointerDown: (event: React.PointerEvent) => void;
  readonly onPointerMove: (event: React.PointerEvent) => void;
  readonly onPointerUp: () => void;
  readonly onPointerCancel: () => void;
  /** Si el clic que llega es el final de un gesto y no un toque. Lo
   * consume: el siguiente vuelve a ser un toque. */
  readonly takeIsGestureClick: () => boolean;
};

/** Los gestos de una fila. Con `null`, la fila no se desliza: escritorio, o
 * una vista sin contacto (FR-090). */
export function useSwipeGesture(swipe: RowSwipe | null): SwipeHandlers {
  const startRef = useRef<Point | null>(null);
  const isGestureClickRef = useRef(false);

  function onPointerDown(event: React.PointerEvent): void {
    if (swipe === null) {
      return;
    }
    startRef.current = { x: event.clientX, y: event.clientY };
    // Con unas acciones abiertas, el toque sólo las cierra: no sube la
    // ficha.
    isGestureClickRef.current = swipe.isAnyOpen;
  }

  function onPointerMove(event: React.PointerEvent): void {
    const start = startRef.current;
    if (swipe === null || start === null) {
      return;
    }
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (Math.abs(dy) > Math.abs(dx)) {
      if (Math.abs(dy) > SWIPE_THRESHOLD_PX) {
        startRef.current = null;
      }
      return;
    }
    if (Math.abs(dx) <= SWIPE_THRESHOLD_PX) {
      return;
    }
    startRef.current = null;
    isGestureClickRef.current = true;
    if (dx < 0) {
      swipe.open();
    } else {
      swipe.close();
    }
  }

  function endGesture(): void {
    startRef.current = null;
  }

  function takeIsGestureClick(): boolean {
    const isGestureClick = isGestureClickRef.current;
    isGestureClickRef.current = false;
    return isGestureClick;
  }

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp: endGesture,
    onPointerCancel: endGesture,
    takeIsGestureClick,
  };
}
