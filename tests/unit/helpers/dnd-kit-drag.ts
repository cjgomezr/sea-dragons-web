import { act } from "@testing-library/react";
import type {
  Active,
  Announcements,
  DndContextProps,
  DragEndEvent,
  Over,
  UniqueIdentifier,
} from "@dnd-kit/core";

/**
 * Arrastrar con dnd-kit sin navegador (#725). jsdom no mide nada (todas las
 * cajas son de 0 × 0), así que los sensores no pueden decidir sobre qué fila
 * cae el puntero. Los tests envuelven `DndContext` para quedarse con sus
 * props y llaman a sus callbacks como lo harían los sensores al soltar.
 */

export type CapturedDndContext = { props: DndContextProps | null };

const EMPTY_RECT = {
  width: 0,
  height: 0,
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
} as const;

function activeOf(id: UniqueIdentifier): Active {
  return {
    id,
    data: { current: undefined },
    rect: { current: { initial: null, translated: null } },
  };
}

function overOf(id: UniqueIdentifier | null): Over | null {
  return id === null
    ? null
    : { id, rect: EMPTY_RECT, disabled: false, data: { current: undefined } };
}

function dragEvent(
  activeId: UniqueIdentifier,
  overId: UniqueIdentifier | null,
): DragEndEvent {
  return {
    activatorEvent: new MouseEvent("mousedown"),
    active: activeOf(activeId),
    over: overOf(overId),
    collisions: null,
    delta: { x: 0, y: 0 },
  };
}

function propsOf(captured: CapturedDndContext): DndContextProps {
  if (captured.props === null) {
    throw new Error("No se pintó ningún DndContext");
  }
  return captured.props;
}

/** Coge `activeId` por el asa, lo pasa por encima de `overId` y lo suelta
 * ahí; `null` es soltarlo fuera de la lista. */
export function dropOn(
  captured: CapturedDndContext,
  activeId: UniqueIdentifier,
  overId: UniqueIdentifier | null,
): void {
  const props = propsOf(captured);
  act(() => {
    props.onDragStart?.(dragEvent(activeId, null));
    props.onDragOver?.(dragEvent(activeId, overId));
    props.onDragEnd?.(dragEvent(activeId, overId));
  });
}

/** Lo que el lector de pantalla oiría en cada momento del arrastre. */
export function announcementsOf(captured: CapturedDndContext): {
  readonly start: (activeId: UniqueIdentifier) => string | undefined;
  readonly over: (
    activeId: UniqueIdentifier,
    overId: UniqueIdentifier | null,
  ) => string | undefined;
  readonly end: (
    activeId: UniqueIdentifier,
    overId: UniqueIdentifier | null,
  ) => string | undefined;
  readonly cancel: (activeId: UniqueIdentifier) => string | undefined;
} {
  const announcements: Announcements | undefined =
    propsOf(captured).accessibility?.announcements;
  if (announcements === undefined) {
    throw new Error("El DndContext no tiene anuncios propios");
  }
  return {
    start: (activeId) => announcements.onDragStart(dragEvent(activeId, null)),
    over: (activeId, overId) =>
      announcements.onDragOver(dragEvent(activeId, overId)),
    end: (activeId, overId) =>
      announcements.onDragEnd(dragEvent(activeId, overId)),
    cancel: (activeId) => announcements.onDragCancel(dragEvent(activeId, null)),
  };
}
