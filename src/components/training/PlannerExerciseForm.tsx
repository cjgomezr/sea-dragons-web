"use client";

import { Plus } from "@phosphor-icons/react/dist/ssr/Plus";
import { Trash } from "@phosphor-icons/react/dist/ssr/Trash";
import { useId, useState } from "react";
import { Icon } from "@/components/Icon";
import type { Translator } from "@/lib/i18n/translator";
import {
  EXERCISE_NAME_MAX_LENGTH,
  EXERCISE_PHOTO_SLOTS,
  EXERCISE_YOUTUBE_MAX_LENGTH,
  type ExercisePhotoSlot,
  type ManagedExercise,
} from "@/lib/training/club-exercises";
import { youtubeFieldText } from "@/lib/training/exercise-planner-view";
import {
  type PhotoDraft,
  PlannerExercisePhotoField,
} from "./PlannerExercisePhotoField";
import { formatRoutineNames } from "./planner-exercises-format";
import {
  EXERCISE_NAME_TAKEN_REASON,
  type ExerciseActionResult,
} from "./use-planner-exercises";

/**
 * El ejercicio del club en Planificar → Ejercicios (#910, RF-10 y D13; §5.1
 * "Tab Exercises" del handoff): nombre, consejos (uno por línea), YouTube y
 * hasta dos fotos, inicio y fin. Nuevo, o uno abierto para cambiarlo todo o
 * borrarlo; uno en una rutina no se borra y lo dice.
 *
 * El nombre repetido lo decide el servidor, sin mayúsculas ni acentos y
 * contra la biblioteca entera (#903): su respuesta se dice junto al campo.
 */

/** Los campos de las fotos en el formulario multipart de la API (#903). */
const PHOTO_FIELDS: Readonly<Record<ExercisePhotoSlot, string>> = {
  start: "startPhoto",
  end: "endPhoto",
};

const REMOVE_FIELDS: Readonly<Record<ExercisePhotoSlot, string>> = {
  start: "removeStartPhoto",
  end: "removeEndPhoto",
};

const REMOVE_VALUE = "true";

type PhotoDrafts = Readonly<Record<ExercisePhotoSlot, PhotoDraft>>;

const KEEP_BOTH: PhotoDrafts = {
  start: { kind: "keep" },
  end: { kind: "keep" },
};

type ExerciseDraft = {
  readonly name: string;
  readonly tips: string;
  readonly youtube: string;
};

function draftOf(exercise: ManagedExercise | null): ExerciseDraft {
  if (exercise === null) {
    return { name: "", tips: "", youtube: "" };
  }
  return {
    name: exercise.name,
    tips: exercise.tips.join("\n"),
    youtube: youtubeFieldText(exercise.youtube),
  };
}

function formDataOf(draft: ExerciseDraft, photos: PhotoDrafts): FormData {
  const data = new FormData();
  data.append("name", draft.name.trim());
  data.append("tips", draft.tips);
  data.append("youtube", draft.youtube);
  for (const slot of EXERCISE_PHOTO_SLOTS) {
    const photo = photos[slot];
    if (photo.kind === "replace") {
      data.append(PHOTO_FIELDS[slot], photo.file);
    }
    if (photo.kind === "remove") {
      data.append(REMOVE_FIELDS[slot], REMOVE_VALUE);
    }
  }
  return data;
}

function TextField({
  label,
  placeholder,
  value,
  maxLength,
  issue,
  onChange,
}: {
  readonly label: string;
  readonly placeholder: string;
  readonly value: string;
  /** Sin él, un área de texto de varias líneas. */
  readonly maxLength?: number;
  /** Lo que se dice junto al campo, o nulo. */
  readonly issue?: string | null;
  readonly onChange: (value: string) => void;
}): React.JSX.Element {
  const fieldId = useId();
  const issueId = `${fieldId}-aviso`;
  const hasIssue = issue !== undefined && issue !== null;
  const shared = {
    id: fieldId,
    value,
    placeholder,
    autoComplete: "off",
    "aria-invalid": hasIssue,
    "aria-describedby": hasIssue ? issueId : undefined,
  };
  return (
    <div className="training-exercise-field">
      <label htmlFor={fieldId}>{label}</label>
      {maxLength === undefined ? (
        <textarea
          {...shared}
          rows={3}
          onChange={(event) => onChange(event.target.value)}
        />
      ) : (
        <input
          {...shared}
          type="text"
          maxLength={maxLength}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
      {hasIssue ? (
        <p className="auth-field-error" id={issueId}>
          {issue}
        </p>
      ) : null}
    </div>
  );
}

function DeleteExercise({
  translate,
  exercise,
  isBusy,
  onDelete,
}: {
  readonly translate: Translator;
  readonly exercise: ManagedExercise;
  readonly isBusy: boolean;
  readonly onDelete: () => void;
}): React.JSX.Element {
  const reasonId = useId();
  const isInUse = exercise.routines.length > 0;
  return (
    <div className="training-exercise-delete">
      <button
        type="button"
        className="training-plan-danger"
        disabled={isBusy || isInUse}
        aria-describedby={isInUse ? reasonId : undefined}
        onClick={onDelete}
      >
        <Icon glyph={Trash} />
        {translate("training.exercises.delete")}
      </button>
      {isInUse ? (
        <p className="training-exercise-hint" id={reasonId}>
          {translate("training.exercises.inUse", {
            routines: formatRoutineNames(exercise.routines),
          })}
        </p>
      ) : null}
    </div>
  );
}

export function PlannerExerciseForm({
  translate,
  exercise,
  headingId,
  isBusy,
  onSubmit,
  onDelete,
}: {
  readonly translate: Translator;
  /** El del club que se abrió, o nulo para uno nuevo. */
  readonly exercise: ManagedExercise | null;
  /** El título que nombra el formulario. */
  readonly headingId: string;
  readonly isBusy: boolean;
  readonly onSubmit: (form: FormData) => Promise<ExerciseActionResult>;
  readonly onDelete: (exercise: ManagedExercise) => void;
}): React.JSX.Element {
  const [draft, setDraft] = useState<ExerciseDraft>(() => draftOf(exercise));
  const [photos, setPhotos] = useState<PhotoDrafts>(KEEP_BOTH);
  const [takenName, setTakenName] = useState<string | null>(null);
  const canSubmit = draft.name.trim() !== "" && !isBusy;

  function change(field: keyof ExerciseDraft, value: string): void {
    setDraft((previous) => ({ ...previous, [field]: value }));
    if (field === "name") {
      setTakenName(null);
    }
  }

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (!canSubmit) {
      return;
    }
    const result = await onSubmit(formDataOf(draft, photos));
    if (
      result.kind === "failed" &&
      result.reason === EXERCISE_NAME_TAKEN_REASON
    ) {
      setTakenName(draft.name.trim());
    }
  }

  return (
    <form
      className="training-exercise-form"
      aria-labelledby={headingId}
      onSubmit={(event) => void submit(event)}
      noValidate
    >
      <TextField
        label={translate("training.exercises.name")}
        placeholder={translate("training.exercises.namePlaceholder")}
        value={draft.name}
        maxLength={EXERCISE_NAME_MAX_LENGTH}
        issue={
          takenName === null
            ? null
            : translate("training.exercises.errorNameTaken")
        }
        onChange={(value) => change("name", value)}
      />
      <TextField
        label={translate("training.exercises.tips")}
        placeholder={translate("training.exercises.tipsPlaceholder")}
        value={draft.tips}
        onChange={(value) => change("tips", value)}
      />
      <TextField
        label={translate("training.exercises.youtube")}
        placeholder={translate("training.exercises.youtubePlaceholder")}
        value={draft.youtube}
        maxLength={EXERCISE_YOUTUBE_MAX_LENGTH}
        onChange={(value) => change("youtube", value)}
      />
      {EXERCISE_PHOTO_SLOTS.map((slot) => (
        <PlannerExercisePhotoField
          key={slot}
          translate={translate}
          slot={slot}
          savedUrl={exercise === null ? null : exercise.photoUrls[slot]}
          draft={photos[slot]}
          onChange={(photo) =>
            setPhotos((previous) => ({ ...previous, [slot]: photo }))
          }
        />
      ))}
      <button
        type="submit"
        className="training-plan-action training-exercise-submit"
        disabled={!canSubmit}
      >
        {exercise === null ? <Icon glyph={Plus} /> : null}
        {translate(
          exercise === null
            ? "training.exercises.add"
            : "training.exercises.save",
        )}
      </button>
      {exercise === null ? (
        <p className="training-exercise-hint">
          {translate("training.exercises.addHint")}
        </p>
      ) : (
        <DeleteExercise
          translate={translate}
          exercise={exercise}
          isBusy={isBusy}
          onDelete={() => onDelete(exercise)}
        />
      )}
    </form>
  );
}
