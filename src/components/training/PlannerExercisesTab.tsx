"use client";

import { Plus } from "@phosphor-icons/react/dist/ssr/Plus";
import { useEffect, useId, useRef, useState } from "react";
import { Icon } from "@/components/Icon";
import type { Translator } from "@/lib/i18n/translator";
import {
  EXERCISE_PHOTO_SLOTS,
  type ManagedExercise,
} from "@/lib/training/club-exercises";
import { PlannerExerciseForm } from "./PlannerExerciseForm";
import { PlannerExerciseList } from "./PlannerExerciseList";
import { exerciseErrorMessage } from "./planner-exercises-format";
import type {
  ExerciseActionResult,
  PlannerExercises,
} from "./use-planner-exercises";

/**
 * Planificar → Ejercicios (#910, RF-10 y D13 del PRD de E35; §5.1 "Tab
 * Exercises" y §5.2 del handoff): a la izquierda la lista, a la derecha el
 * formulario New club exercise. Una fila abre su ejercicio en ese lado: uno
 * del club para cambiarlo o borrarlo, uno de la biblioteca para leerlo. En
 * el móvil, la lista va encima.
 */

/** Lo que enseña el lado del formulario. */
type OpenExercise =
  | { readonly kind: "new" }
  | { readonly kind: "open"; readonly exercise: ManagedExercise };

const NEW_EXERCISE: OpenExercise = { kind: "new" };

const PHOTO_ALT_KEYS = {
  start: "training.exercises.photoStartAlt",
  end: "training.exercises.photoEndAlt",
} as const;

function ExercisesMessages({
  translate,
  planner,
}: {
  readonly translate: Translator;
  readonly planner: PlannerExercises;
}): React.JSX.Element {
  return (
    <>
      <p className="training-plan-notice" role="status">
        {planner.notice}
      </p>
      {planner.error === null ? null : (
        <p className="auth-error" role="alert">
          {exerciseErrorMessage(translate, planner.error)}
        </p>
      )}
    </>
  );
}

function LibraryExercise({
  translate,
  exercise,
}: {
  readonly translate: Translator;
  readonly exercise: ManagedExercise;
}): React.JSX.Element {
  const photos = EXERCISE_PHOTO_SLOTS.flatMap((slot) => {
    const url = exercise.photoUrls[slot];
    return url === null ? [] : [{ slot, url }];
  });
  return (
    <div className="training-exercise-library">
      <p className="training-exercise-hint">
        {translate("training.exercises.libraryReadOnly")}
      </p>
      {photos.length === 0 ? null : (
        <div className="training-exercise-library-photos">
          {photos.map(({ slot, url }) => (
            // eslint-disable-next-line @next/next/no-img-element -- fotos de Storage, como las de la vista del socio.
            <img
              key={slot}
              src={url}
              alt={translate(PHOTO_ALT_KEYS[slot], { name: exercise.name })}
            />
          ))}
        </div>
      )}
      {exercise.tips.length === 0 ? null : (
        <ul className="training-exercise-library-tips">
          {exercise.tips.map((tip) => (
            <li key={tip}>{tip}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ExercisePanel({
  translate,
  planner,
  open,
  formKey,
  headingRef,
  onNew,
  onSaved,
}: {
  readonly translate: Translator;
  readonly planner: PlannerExercises;
  readonly open: OpenExercise;
  /** Cambia para que el formulario vuelva a empezar. */
  readonly formKey: number;
  readonly headingRef: React.RefObject<HTMLHeadingElement | null>;
  readonly onNew: () => void;
  readonly onSaved: (exercise: ManagedExercise | null) => void;
}): React.JSX.Element {
  const headingId = useId();
  const exercise = open.kind === "open" ? open.exercise : null;

  async function save(form: FormData): Promise<ExerciseActionResult> {
    const result =
      exercise === null
        ? await planner.create(form)
        : await planner.update(exercise, form);
    if (result.kind === "done") {
      onSaved(exercise === null ? null : result.exercise);
    }
    return result;
  }

  async function remove(target: ManagedExercise): Promise<void> {
    const result = await planner.remove(target);
    if (result.kind === "done") {
      onSaved(null);
    }
  }

  return (
    <section className="training-exercise-panel" aria-labelledby={headingId}>
      <div className="training-exercise-panel-head">
        <h2 id={headingId} ref={headingRef} tabIndex={-1}>
          {exercise === null
            ? translate("training.exercises.newTitle")
            : exercise.name}
        </h2>
        {exercise === null ? null : (
          <button
            type="button"
            className="training-plan-action training-plan-action-new"
            onClick={onNew}
          >
            <Icon glyph={Plus} />
            {translate("training.exercises.newTitle")}
          </button>
        )}
      </div>
      {exercise === null ? (
        <p className="training-exercise-hint">
          {translate("training.exercises.newLead")}
        </p>
      ) : null}
      {exercise !== null && exercise.source === "library" ? (
        <LibraryExercise translate={translate} exercise={exercise} />
      ) : (
        <PlannerExerciseForm
          key={`${exercise?.id ?? "nuevo"}-${formKey}`}
          translate={translate}
          exercise={exercise}
          headingId={headingId}
          isBusy={planner.isBusy}
          onSubmit={save}
          onDelete={(target) => void remove(target)}
        />
      )}
    </section>
  );
}

export function PlannerExercisesTab({
  translate,
  planner,
}: {
  readonly translate: Translator;
  readonly planner: PlannerExercises;
}): React.JSX.Element {
  const [open, setOpen] = useState<OpenExercise>(NEW_EXERCISE);
  const [formKey, setFormKey] = useState(0);
  // Cuántas veces se eligió qué enseñar: al elegir, el foco va al título
  // del lado del formulario, que en el móvil está debajo de la lista.
  const [choices, setChoices] = useState(0);
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (choices > 0) {
      headingRef.current?.focus();
    }
  }, [choices]);

  function show(next: OpenExercise): void {
    setOpen(next);
    setFormKey((previous) => previous + 1);
    setChoices((previous) => previous + 1);
  }

  return (
    <div className="training-exercises">
      <ExercisesMessages translate={translate} planner={planner} />
      <div className="training-exercises-layout">
        <PlannerExerciseList
          translate={translate}
          planner={planner}
          openId={open.kind === "open" ? open.exercise.id : null}
          onOpen={(exercise) => show({ kind: "open", exercise })}
        />
        <ExercisePanel
          translate={translate}
          planner={planner}
          open={open}
          formKey={formKey}
          headingRef={headingRef}
          onNew={() => show(NEW_EXERCISE)}
          onSaved={(saved) => {
            setOpen(
              saved === null ? NEW_EXERCISE : { kind: "open", exercise: saved },
            );
            setFormKey((previous) => previous + 1);
          }}
        />
      </div>
    </div>
  );
}
