"use client";

import { MagnifyingGlass } from "@phosphor-icons/react/dist/ssr/MagnifyingGlass";
import { Plus } from "@phosphor-icons/react/dist/ssr/Plus";
import { useId, useState } from "react";
import { Icon } from "@/components/Icon";
import type { Translator } from "@/lib/i18n/translator";
import {
  EXERCISE_NAME_MAX_LENGTH,
  type ManagedExercise,
} from "@/lib/training/club-exercises";
import type { RoutineExerciseSummary } from "@/lib/training/club-routines";
import { ExercisePhoto } from "./TrainingExerciseRow";
import {
  type ExerciseSearchState,
  useExerciseSearch,
} from "./use-exercise-search";

/**
 * La fila de añadir del editor de rutinas (#909, RF-9 del PRD de E35; §5.1
 * "Add row" y §5.2 del handoff): un combobox que busca en la biblioteca y en
 * el club, con el mismo patrón que el buscador de destinatarios del correo
 * (E33). ↑ y ↓ mueven, Enter elige y Esc cierra. Sin resultados, ofrece crear
 * el ejercicio del club con el nombre escrito.
 *
 * En el escritorio los resultados cuelgan del campo; en el móvil van en
 * línea, debajo, y siguen a la vista aunque el teclado se cierre.
 */

/** Dónde salen los resultados: colgando del campo, o en línea debajo. */
export type ResultsPlacement = "popover" | "inline";

type AddExerciseProps = {
  readonly translate: Translator;
  readonly placement: ResultsPlacement;
  /** Verdadero si la fila entró. */
  readonly onChoose: (exercise: RoutineExerciseSummary) => Promise<boolean>;
  /** Verdadero si se creó y la fila entró. */
  readonly onCreate: (name: string) => Promise<boolean>;
};

function summaryOf(exercise: ManagedExercise): RoutineExerciseSummary {
  return {
    id: exercise.id,
    name: exercise.name,
    photoUrl: exercise.thumbnailUrl,
  };
}

function ResultOption({
  translate,
  id,
  exercise,
  isHighlighted,
  onChoose,
}: {
  readonly translate: Translator;
  readonly id: string;
  readonly exercise: ManagedExercise;
  readonly isHighlighted: boolean;
  readonly onChoose: (exercise: ManagedExercise) => void;
}): React.JSX.Element {
  return (
    // El teclado lo maneja el combobox (aria-activedescendant): la opción
    // sólo atiende al ratón, y sin robarle el foco al campo.
    <li
      id={id}
      role="option"
      aria-selected={isHighlighted}
      className="training-routine-add-option"
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => onChoose(exercise)}
    >
      <span className="training-routine-thumbnail">
        <ExercisePhoto url={exercise.thumbnailUrl ?? undefined} alt="" />
      </span>
      <span className="training-routine-add-option-name">{exercise.name}</span>
      <span className="training-exercises-tag">
        {translate(
          exercise.source === "library"
            ? "training.exercises.sourceLibrary"
            : "training.exercises.sourceClub",
        )}
      </span>
    </li>
  );
}

/** Lo que dicen los resultados cuando no hay opciones que enseñar. */
function SearchOutcome({
  translate,
  search,
  text,
  isAdding,
  onCreate,
}: {
  readonly translate: Translator;
  readonly search: ExerciseSearchState;
  readonly text: string;
  readonly isAdding: boolean;
  readonly onCreate: () => void;
}): React.JSX.Element | null {
  if (search.kind === "searching") {
    return (
      <p className="training-routine-add-status" role="status">
        {translate("training.manage.searchingExercises")}
      </p>
    );
  }
  if (search.kind === "failed") {
    return (
      <p className="training-routine-add-status auth-error" role="alert">
        {translate("training.manage.searchFailed")}
      </p>
    );
  }
  if (search.kind !== "found" || search.exercises.length > 0) {
    return null;
  }
  return (
    <div className="training-routine-add-none">
      <p className="training-routine-add-status" role="status">
        {translate("training.exercises.noMatch", { query: text })}
      </p>
      <button
        type="button"
        className="training-routine-add-create"
        disabled={isAdding}
        onMouseDown={(event) => event.preventDefault()}
        onClick={onCreate}
      >
        <Icon glyph={Plus} />
        {translate("training.manage.createExercise", { name: text })}
      </button>
    </div>
  );
}

export function PlannerRoutineAddExercise({
  translate,
  placement,
  onChoose,
  onCreate,
}: AddExerciseProps): React.JSX.Element {
  const listboxId = useId();
  const [query, setQuery] = useState("");
  const [isFocused, setIsFocused] = useState(false);
  const [isDismissed, setIsDismissed] = useState(false);
  const [isAdding, setIsAdding] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const search = useExerciseSearch(query);
  const text = query.trim();

  const exercises = search.kind === "found" ? search.exercises : [];
  const highlightedIndex = Math.min(highlighted, exercises.length - 1);
  const isInline = placement === "inline";
  const isOpen = (isFocused || isInline) && text !== "" && !isDismissed;
  const isExpanded = isOpen && exercises.length > 0;
  const optionId = (index: number): string => `${listboxId}-${index}`;

  function changeQuery(next: string): void {
    setQuery(next);
    setHighlighted(0);
    setIsDismissed(false);
  }

  async function add(adding: () => Promise<boolean>): Promise<void> {
    if (isAdding) {
      return;
    }
    setIsAdding(true);
    const isAdded = await adding();
    setIsAdding(false);
    if (isAdded) {
      changeQuery("");
    }
  }

  function choose(exercise: ManagedExercise): void {
    void add(() => onChoose(summaryOf(exercise)));
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>): void {
    if (event.key === "Escape") {
      setIsDismissed(true);
      return;
    }
    if (!isExpanded) {
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const exercise = exercises[highlightedIndex];
      if (exercise !== undefined) {
        choose(exercise);
      }
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      const count = exercises.length;
      setHighlighted((highlightedIndex + step + count) % count);
    }
  }

  return (
    <div className="training-routine-add" data-placement={placement}>
      <div className="training-routine-add-field">
        <span className="training-routine-add-icon" aria-hidden="true">
          <Icon glyph={isInline ? MagnifyingGlass : Plus} />
        </span>
        <input
          type="text"
          role="combobox"
          autoComplete="off"
          // Lo escrito puede acabar siendo el nombre de un ejercicio nuevo.
          maxLength={EXERCISE_NAME_MAX_LENGTH}
          aria-label={translate("training.manage.addExercise")}
          placeholder={translate("training.manage.addExercisePlaceholder")}
          aria-autocomplete="list"
          aria-busy={isAdding}
          aria-expanded={isExpanded}
          aria-controls={listboxId}
          aria-activedescendant={
            isExpanded ? optionId(highlightedIndex) : undefined
          }
          value={query}
          onChange={(event) => changeQuery(event.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
        />
      </div>
      <div className="training-routine-add-results" hidden={!isOpen}>
        <ul
          id={listboxId}
          role="listbox"
          aria-label={translate("training.manage.addExercise")}
          hidden={!isExpanded}
        >
          {exercises.map((exercise, index) => (
            <ResultOption
              key={exercise.id}
              translate={translate}
              id={optionId(index)}
              exercise={exercise}
              isHighlighted={index === highlightedIndex}
              onChoose={choose}
            />
          ))}
        </ul>
        {isOpen ? (
          <SearchOutcome
            translate={translate}
            search={search}
            text={text}
            isAdding={isAdding}
            onCreate={() => void add(() => onCreate(text))}
          />
        ) : null}
      </div>
    </div>
  );
}
