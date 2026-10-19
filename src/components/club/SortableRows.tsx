"use client";

import {
  type Active,
  type Announcements,
  DndContext,
  type DragEndEvent,
  MouseSensor,
  type Over,
  TouchSensor,
  type UniqueIdentifier,
  closestCenter,
  useDndContext,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { dropLineEdge, orderAfterDrop } from "@/lib/club/drop-order";
import type { Translator } from "@/lib/i18n/translator";

/**
 * Arrastrar filas por el asa con ratón o con el dedo (#725, RF-8 y D1 del
 * PRD de E26), con dnd-kit: el arrastre nativo del navegador no es fiable
 * con el dedo en Android. Lo usan las posiciones y los packs.
 *
 * Sin el sensor de teclado de dnd-kit: el asa ya mueve con ↑ y ↓, y cada
 * lista lo hace a su manera.
 *
 * Las demás filas no se apartan mientras se arrastra: una línea de acento
 * marca dónde caerá. Con el ratón la fila se queda en su sitio y se apaga;
 * con el dedo se levanta y lo sigue, porque la tapa la propia mano.
 */

/** Lo que hay que mover el ratón con el botón pulsado para que empiece: un
 * clic que tiembla un poco no arrastra. */
const MOUSE_DRAG_DISTANCE_PX = 4;
/** Lo que hay que mantener el dedo en el asa: un toque más corto deja hacer
 * scroll. */
const TOUCH_HOLD_MS = 150;
/** Lo que puede moverse el dedo mientras se mantiene sin cancelarlo. */
const TOUCH_TOLERANCE_PX = 5;
const LIFTED_SCALE = 1.02;

/** Las filas de la lista, en su orden, y cómo se llama cada una. */
type SortableItems<Item> = {
  readonly items: readonly Item[];
  /** Lo que identifica la fila para dnd-kit: el id de la posición, el
   * número de sesiones del pack. */
  readonly idOf: (item: Item) => UniqueIdentifier;
  /** Cómo se nombra una fila en los anuncios: "Defender", "the 5 sessions
   * pack". */
  readonly describeItem: (item: Item) => string;
};

type SortableListProps<Item> = SortableItems<Item> & {
  readonly translate: Translator;
  /** Con una acción esperando al servidor no se puede arrastrar. */
  readonly isDisabled: boolean;
  /** Sólo cuando el orden cambia de verdad. */
  readonly onDrop: (order: readonly Item[], moved: Item) => void;
  readonly children: React.ReactNode;
};

function findItem<Item>(
  { items, idOf }: Pick<SortableItems<Item>, "items" | "idOf">,
  id: UniqueIdentifier | undefined,
): Item | null {
  return items.find((item) => idOf(item) === id) ?? null;
}

type DraggedItem = { readonly item: string; readonly rank: number };

/** Lo que oye el lector de pantalla al coger, pasar por encima y soltar. */
function reorderAnnouncements<Item>(
  translate: Translator,
  list: SortableItems<Item>,
): Announcements {
  const { items, describeItem } = list;
  const total = items.length;
  const rankOf = (id: UniqueIdentifier | undefined): number | null => {
    const found = findItem(list, id);
    return found === null ? null : items.indexOf(found) + 1;
  };
  /** El anuncio de un momento del arrastre, o ninguno si lo arrastrado no
   * es de esta lista. */
  const announce =
    (say: (dragged: DraggedItem, overRank: number | null) => string) =>
    ({ active, over }: { active: Active; over?: Over | null }) => {
      const dragged = findItem(list, active.id);
      return dragged === null
        ? undefined
        : say(
            { item: describeItem(dragged), rank: items.indexOf(dragged) + 1 },
            rankOf(over?.id),
          );
    };

  return {
    onDragStart: announce((dragged) =>
      translate("clubSettings.reorder.pickedUp", { ...dragged, total }),
    ),
    onDragOver: announce(({ item }, rank) =>
      rank === null
        ? translate("clubSettings.reorder.outside", { item })
        : translate("clubSettings.reorder.over", { item, rank, total }),
    ),
    onDragEnd: announce((dragged, rank) =>
      rank === null || rank === dragged.rank
        ? translate("clubSettings.reorder.droppedInPlace", {
            ...dragged,
            total,
          })
        : translate("clubSettings.reorder.dropped", {
            item: dragged.item,
            rank,
            total,
          }),
    ),
    onDragCancel: announce((dragged) =>
      translate("clubSettings.reorder.cancelled", { ...dragged, total }),
    ),
  };
}

export function SortableList<Item>({
  translate,
  isDisabled,
  onDrop,
  children,
  ...list
}: SortableListProps<Item>): React.JSX.Element {
  const sensors = useSensors(
    useSensor(MouseSensor, {
      activationConstraint: { distance: MOUSE_DRAG_DISTANCE_PX },
    }),
    useSensor(TouchSensor, {
      activationConstraint: {
        delay: TOUCH_HOLD_MS,
        tolerance: TOUCH_TOLERANCE_PX,
      },
    }),
  );
  const announcements = reorderAnnouncements(translate, list);

  function handleDragEnd({ active, over }: DragEndEvent): void {
    const moved = findItem(list, active.id);
    if (isDisabled || moved === null) {
      return;
    }
    const order = orderAfterDrop(list.items, moved, findItem(list, over?.id));
    if (order !== null) {
      onDrop(order, moved);
    }
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      accessibility={{
        announcements,
        screenReaderInstructions: {
          draggable: translate("clubSettings.reorder.hint"),
        },
      }}
      onDragEnd={handleDragEnd}
    >
      <SortableContext
        items={list.items.map(list.idOf)}
        strategy={verticalListSortingStrategy}
        disabled={isDisabled}
      >
        {children}
      </SortableContext>
    </DndContext>
  );
}

/** Lo que una fila pone en su `<li>` y en su asa para poder arrastrarse. */
export type SortableRowBinding = {
  readonly setRowNode: (element: HTMLElement | null) => void;
  /** Las clases de arrastre, vacío si no le toca ninguna. */
  readonly rowClassName: string;
  readonly rowStyle: React.CSSProperties | undefined;
  readonly setHandleNode: (element: HTMLElement | null) => void;
  readonly handleListeners: ReturnType<typeof useSortable>["listeners"];
};

function isTouchDrag(activatorEvent: Event | null): boolean {
  return activatorEvent?.type.startsWith("touch") ?? false;
}

function rowClassNames(classes: Readonly<Record<string, boolean>>): string {
  return Object.keys(classes)
    .filter((name) => classes[name])
    .join(" ");
}

export function useSortableRow(id: UniqueIdentifier): SortableRowBinding {
  const {
    setNodeRef,
    setActivatorNodeRef,
    listeners,
    transform,
    isDragging,
    isOver,
    active,
    items,
  } = useSortable({ id });
  const { activatorEvent } = useDndContext();
  const isLifted = isDragging && isTouchDrag(activatorEvent);
  const edge =
    isOver && active !== null ? dropLineEdge(items, active.id, id) : null;
  return {
    setRowNode: setNodeRef,
    rowClassName: rowClassNames({
      "sortable-row-dragging": isDragging && !isLifted,
      "sortable-row-lifted": isLifted,
      "sortable-row-drop-before": edge === "before",
      "sortable-row-drop-after": edge === "after",
    }),
    rowStyle:
      isLifted && transform !== null
        ? {
            transform: `translate3d(0, ${transform.y}px, 0) scale(${LIFTED_SCALE})`,
          }
        : undefined,
    setHandleNode: setActivatorNodeRef,
    handleListeners: listeners,
  };
}
