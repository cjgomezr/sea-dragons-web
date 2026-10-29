"use client";

import { Image as ImageGlyph } from "@phosphor-icons/react/dist/ssr/Image";
import { UploadSimple } from "@phosphor-icons/react/dist/ssr/UploadSimple";
import { X } from "@phosphor-icons/react/dist/ssr/X";
import { useEffect, useId, useState } from "react";
import { Icon } from "@/components/Icon";
import type { MessageKey } from "@/lib/i18n/message";
import type { Translator } from "@/lib/i18n/translator";
import type { ExercisePhotoSlot } from "@/lib/training/club-exercises";
import {
  type PhotoIssue,
  checkExercisePhoto,
} from "@/lib/training/exercise-planner-view";

/**
 * Una de las dos fotos de un ejercicio del club (#910, D13): la de inicio o
 * la de fin. Enseña la que tiene o la elegida, deja quitarla y no acepta una
 * de más de 5 MB ni de otro formato: lo dice y no la guarda.
 */

/** Lo que se hará con la foto al guardar. */
export type PhotoDraft =
  | { readonly kind: "keep" }
  | { readonly kind: "remove" }
  | {
      readonly kind: "replace";
      readonly file: File;
      /** La vista previa, que vive mientras esté elegida. */
      readonly previewUrl: string;
    };

const ACCEPTED_TYPES = "image/jpeg,image/png,image/webp";

const LABEL_KEYS = {
  start: "training.exercises.startPhoto",
  end: "training.exercises.endPhoto",
} as const satisfies Record<ExercisePhotoSlot, MessageKey>;

const REMOVE_KEYS = {
  start: "training.exercises.removeStartPhoto",
  end: "training.exercises.removeEndPhoto",
} as const satisfies Record<ExercisePhotoSlot, MessageKey>;

const ISSUE_KEYS = {
  photo_too_large: "training.exercises.photoTooLarge",
  photo_type_unsupported: "training.exercises.photoType",
} as const satisfies Record<PhotoIssue, MessageKey>;

function previewOf(draft: PhotoDraft, savedUrl: string | null): string | null {
  if (draft.kind === "replace") {
    return draft.previewUrl;
  }
  return draft.kind === "keep" ? savedUrl : null;
}

export function PlannerExercisePhotoField({
  translate,
  slot,
  savedUrl,
  draft,
  onChange,
}: {
  readonly translate: Translator;
  readonly slot: ExercisePhotoSlot;
  /** La que ya tiene el ejercicio, o nula. */
  readonly savedUrl: string | null;
  readonly draft: PhotoDraft;
  readonly onChange: (draft: PhotoDraft) => void;
}): React.JSX.Element {
  const inputId = useId();
  const issueId = `${inputId}-aviso`;
  const [issue, setIssue] = useState<PhotoIssue | null>(null);
  const preview = previewOf(draft, savedUrl);
  const chosenUrl = draft.kind === "replace" ? draft.previewUrl : null;

  useEffect(
    () => () => {
      if (chosenUrl !== null) {
        URL.revokeObjectURL(chosenUrl);
      }
    },
    [chosenUrl],
  );
  const hasPhoto =
    draft.kind === "replace" || (draft.kind === "keep" && savedUrl !== null);

  function choose(event: React.ChangeEvent<HTMLInputElement>): void {
    const file = event.target.files?.item(0) ?? null;
    // Vacío, el mismo fichero se puede volver a elegir después.
    event.target.value = "";
    if (file === null) {
      return;
    }
    const found = checkExercisePhoto(file);
    setIssue(found);
    if (found === null) {
      onChange({
        kind: "replace",
        file,
        previewUrl: URL.createObjectURL(file),
      });
    }
  }

  function remove(): void {
    setIssue(null);
    onChange(savedUrl === null ? { kind: "keep" } : { kind: "remove" });
  }

  return (
    <div className="training-exercise-photo">
      <div className="training-exercise-photo-box">
        {preview === null ? (
          <span className="training-exercise-photo-icon">
            <Icon glyph={ImageGlyph} />
          </span>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element -- una foto de Storage o del disco, sin optimizar
          <img
            className="training-exercise-photo-preview"
            src={preview}
            alt=""
          />
        )}
        <span className="training-exercise-photo-text">
          <label htmlFor={inputId}>{translate(LABEL_KEYS[slot])}</label>
          <span className="training-exercise-photo-hint">
            {draft.kind === "replace"
              ? draft.file.name
              : translate("training.exercises.photoHint")}
          </span>
        </span>
        <input
          id={inputId}
          className="visually-hidden"
          type="file"
          accept={ACCEPTED_TYPES}
          aria-describedby={issue === null ? undefined : issueId}
          onChange={choose}
        />
        <label className="training-exercise-photo-upload" htmlFor={inputId}>
          <Icon glyph={UploadSimple} />
          {translate("training.exercises.upload")}
        </label>
        {hasPhoto ? (
          <button
            type="button"
            className="training-marks-icon-button"
            aria-label={translate(REMOVE_KEYS[slot])}
            onClick={remove}
          >
            <Icon glyph={X} />
          </button>
        ) : null}
      </div>
      {issue === null ? null : (
        <p className="auth-field-error" id={issueId}>
          {translate(ISSUE_KEYS[issue])}
        </p>
      )}
    </div>
  );
}
