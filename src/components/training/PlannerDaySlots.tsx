"use client";

import { Plus } from "@phosphor-icons/react/dist/ssr/Plus";
import { X } from "@phosphor-icons/react/dist/ssr/X";
import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/Icon";
import type { Translator } from "@/lib/i18n/translator";
import type { CycleDayChange, CycleDaySlot } from "@/lib/training/club-cycles";
import type { DayRoutines, GridDay } from "@/lib/training/cycle-grid-view";
import { gridWeekdayName } from "./planner-format";
import { routineColorStyle } from "./training-format";

/**
 * Las rutinas de un día de la cuadrícula (#907, D7): un `<select>` con
 * "Rest" y las rutinas, y con una puesta, un "+" que abre el segundo. Con
 * dos no hay "+": no cabe una tercera; la "×" quita la segunda.
 */

/** Las opciones del `<select>`, pintadas una vez para toda la cuadrícula:
 * con 52 semanas son hasta 728 selectores. */
export type GridOptions = {
  readonly elements: React.JSX.Element;
  readonly colorOf: ReadonlyMap<string, number>;
};

const REST_VALUE = "";

export type DaySlotsProps = {
  readonly translate: Translator;
  readonly options: GridOptions;
  readonly day: GridDay;
  readonly routines: DayRoutines;
  readonly isReadOnly: boolean;
  readonly onChange: (change: CycleDayChange) => void;
};

function SlotSelect({
  label,
  options,
  routineId,
  isReadOnly,
  selectRef,
  onChoose,
}: {
  readonly label: string;
  readonly options: GridOptions;
  readonly routineId: string | null;
  readonly isReadOnly: boolean;
  readonly selectRef?: React.Ref<HTMLSelectElement>;
  readonly onChoose: (routineId: string | null) => void;
}): React.JSX.Element {
  const colorIndex =
    routineId === null ? undefined : options.colorOf.get(routineId);
  return (
    <select
      ref={selectRef}
      className={
        colorIndex === undefined
          ? "training-grid-select"
          : "training-grid-select training-grid-select-routine"
      }
      style={
        colorIndex === undefined ? undefined : routineColorStyle(colorIndex)
      }
      aria-label={label}
      value={routineId ?? REST_VALUE}
      disabled={isReadOnly}
      onChange={(event) =>
        onChoose(event.target.value === REST_VALUE ? null : event.target.value)
      }
    >
      {options.elements}
    </select>
  );
}

/** El segundo `<select>` y, si el ciclo se puede cambiar, la "×" que lo
 * cierra o quita la segunda rutina (#942): elegir "Rest" otra vez sobre un
 * selector recién abierto no dispara `change`. */
function SecondSlot({
  label,
  removeLabel,
  options,
  routineId,
  isReadOnly,
  selectRef,
  onChoose,
  onRemove,
}: {
  readonly label: string;
  readonly removeLabel: string;
  readonly options: GridOptions;
  readonly routineId: string | null;
  readonly isReadOnly: boolean;
  readonly selectRef: React.Ref<HTMLSelectElement>;
  readonly onChoose: (routineId: string | null) => void;
  readonly onRemove: () => void;
}): React.JSX.Element {
  return (
    <div className="training-grid-slot">
      <SlotSelect
        label={label}
        options={options}
        routineId={routineId}
        isReadOnly={isReadOnly}
        selectRef={selectRef}
        onChoose={onChoose}
      />
      {isReadOnly ? null : (
        <button
          type="button"
          className="training-grid-add"
          aria-label={removeLabel}
          onClick={onRemove}
        >
          <Icon glyph={X} />
        </button>
      )}
    </div>
  );
}

export function PlannerDaySlots({
  translate,
  options,
  day,
  routines,
  isReadOnly,
  onChange,
}: DaySlotsProps): React.JSX.Element {
  const [isAddingSecond, setIsAddingSecond] = useState(false);
  const secondRef = useRef<HTMLSelectElement>(null);
  const addRef = useRef<HTMLButtonElement>(null);
  // Al quitar la segunda, el foco vuelve al "+" en cuanto este reaparece.
  const shouldFocusAdd = useRef(false);
  const names = {
    week: day.weekNo,
    day: gridWeekdayName(translate, day.weekday),
  };
  const hasSecond =
    routines.first !== null && (routines.second !== null || isAddingSecond);
  const canAddSecond = routines.first !== null && !hasSecond && !isReadOnly;

  useEffect(() => {
    if (isAddingSecond) {
      secondRef.current?.focus();
    }
  }, [isAddingSecond]);

  useEffect(() => {
    if (canAddSecond && shouldFocusAdd.current) {
      shouldFocusAdd.current = false;
      addRef.current?.focus();
    }
  }, [canAddSecond]);

  function choose(slot: CycleDaySlot, routineId: string | null): void {
    if (slot === 2 || routineId === null) {
      setIsAddingSecond(false);
    }
    onChange({ weekNo: day.weekNo, weekday: day.weekday, slot, routineId });
  }

  function removeSecond(): void {
    shouldFocusAdd.current = true;
    if (routines.second === null) {
      setIsAddingSecond(false);
      return;
    }
    choose(2, null);
  }

  return (
    <div className="training-grid-slots">
      <div className="training-grid-slot">
        <SlotSelect
          label={translate("training.manage.daySlot", names)}
          options={options}
          routineId={routines.first}
          isReadOnly={isReadOnly}
          onChoose={(routineId) => choose(1, routineId)}
        />
        {canAddSecond ? (
          <button
            ref={addRef}
            type="button"
            className="training-grid-add"
            aria-label={translate("training.manage.addSecondRoutine", names)}
            onClick={() => setIsAddingSecond(true)}
          >
            <Icon glyph={Plus} />
          </button>
        ) : null}
      </div>
      {hasSecond ? (
        <SecondSlot
          label={translate("training.manage.daySecondSlot", names)}
          removeLabel={translate("training.manage.removeSecondRoutine", names)}
          options={options}
          routineId={routines.second}
          isReadOnly={isReadOnly}
          selectRef={secondRef}
          onChoose={(routineId) => choose(2, routineId)}
          onRemove={removeSecond}
        />
      ) : null}
    </div>
  );
}
