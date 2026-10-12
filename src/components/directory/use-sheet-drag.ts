"use client";

import { useRef, useState } from "react";

/**
 * Arrastrar la hoja desde arriba para cerrarla (#579), como en las hojas de
 * iOS: mientras el dedo baja, la hoja baja con él; al soltar, se cierra si
 * bajó lo bastante y si no vuelve a su sitio. Hacia arriba no sube.
 *
 * Sólo la zona de arriba recibe estos manejadores: el contenido de la hoja
 * hace scroll con el mismo gesto.
 */

/** Lo que hay que bajar la hoja para que, al soltarla, se cierre. Menos la
 * cierra al rozar la cabecera camino del contenido. */
export const SHEET_CLOSE_DISTANCE_PX = 80;

/** Lo que puede temblar un toque sin dejar de ser un toque: hasta ahí, el
 * asa y la foto de la cabecera reciben su clic. */
const TAP_SLOP_PX = 8;

type Gesture = {
  readonly pointerId: number;
  readonly startY: number;
  readonly isDragging: boolean;
};

type DragHandlers = Required<
  Pick<
    React.HTMLAttributes<HTMLElement>,
    | "onPointerDown"
    | "onPointerMove"
    | "onPointerUp"
    | "onPointerCancel"
    | "onClickCapture"
  >
>;

export type SheetDrag = {
  /** Lo que la hoja ha bajado, en píxeles; 0 en su sitio. */
  readonly offset: number;
  readonly isDragging: boolean;
  readonly handlers: DragHandlers;
};

function offsetOf(gesture: Gesture, clientY: number): number {
  return Math.max(0, clientY - gesture.startY);
}

export function useSheetDrag(onDismiss: () => void): SheetDrag {
  const gestureRef = useRef<Gesture | null>(null);
  // El clic que el navegador manda al soltar un arrastre no es un toque: si
  // llegara al asa, cerraría la hoja que el dedo acaba de devolver a su sitio.
  const wasDraggedRef = useRef(false);
  const [offset, setOffset] = useState(0);
  const [isDragging, setIsDragging] = useState(false);

  function currentGesture(event: React.PointerEvent): Gesture | null {
    const gesture = gestureRef.current;
    return gesture !== null && gesture.pointerId === event.pointerId
      ? gesture
      : null;
  }

  function endGesture(): void {
    gestureRef.current = null;
    setIsDragging(false);
    setOffset(0);
  }

  function startDragging(event: React.PointerEvent, gesture: Gesture): void {
    event.currentTarget.setPointerCapture(event.pointerId);
    gestureRef.current = { ...gesture, isDragging: true };
    wasDraggedRef.current = true;
    setIsDragging(true);
  }

  return {
    offset,
    isDragging,
    handlers: {
      onPointerDown: (event) => {
        if (gestureRef.current !== null || event.button !== 0) {
          return;
        }
        wasDraggedRef.current = false;
        gestureRef.current = {
          pointerId: event.pointerId,
          startY: event.clientY,
          isDragging: false,
        };
      },
      onPointerMove: (event) => {
        const gesture = currentGesture(event);
        if (gesture === null) {
          return;
        }
        const isStillATap =
          Math.abs(event.clientY - gesture.startY) < TAP_SLOP_PX;
        if (!gesture.isDragging && isStillATap) {
          return;
        }
        if (!gesture.isDragging) {
          startDragging(event, gesture);
        }
        setOffset(offsetOf(gesture, event.clientY));
      },
      onPointerUp: (event) => {
        const gesture = currentGesture(event);
        if (gesture === null) {
          return;
        }
        const shouldClose =
          gesture.isDragging &&
          offsetOf(gesture, event.clientY) >= SHEET_CLOSE_DISTANCE_PX;
        endGesture();
        if (shouldClose) {
          onDismiss();
        }
      },
      onPointerCancel: (event) => {
        if (currentGesture(event) !== null) {
          endGesture();
        }
      },
      onClickCapture: (event) => {
        if (!wasDraggedRef.current) {
          return;
        }
        wasDraggedRef.current = false;
        event.preventDefault();
        event.stopPropagation();
      },
    },
  };
}
