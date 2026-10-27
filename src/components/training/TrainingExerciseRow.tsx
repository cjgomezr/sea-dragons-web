"use client";

import { CaretDown } from "@phosphor-icons/react/dist/ssr/CaretDown";
import { PersonSimpleRun } from "@phosphor-icons/react/dist/ssr/PersonSimpleRun";
import { YoutubeLogo } from "@phosphor-icons/react/dist/ssr/YoutubeLogo";
import { useId, useState } from "react";
import { Icon } from "@/components/Icon";
import type { Translator } from "@/lib/i18n/translator";
import {
  type ExerciseRow,
  type MarkValues,
  markUsedByRow,
  rowPrescription,
} from "@/lib/training/routine-row-view";
import type {
  ResolvedLoad,
  TrainingPrescription,
  WeekDose,
} from "@/lib/training/training-load";
import { TrainingMarkField } from "./TrainingMarkField";
import type { SaveMark } from "./use-member-marks";

/**
 * Una fila de ejercicio de la rutina del día (#901, RF-4 y §4.1 del handoff):
 * la miniatura, el nombre, la dosis y la carga con los kilos del socio. Se
 * abre con el campo de la marca, las fotos, los consejos y YouTube.
 *
 * Las fotos son `<img>` y no `next/image`, como la portada de un evento: el
 * optimizador de Next no conoce el bucket. Una foto que no carga cae al icono
 * genérico en vez de dejar un icono roto.
 */

export type RowContext = {
  readonly weekDose: WeekDose | null;
  readonly markValues: MarkValues;
  readonly onSaveMark: SaveMark;
};

function ExercisePhoto({
  url,
  alt,
}: {
  readonly url: string | undefined;
  readonly alt: string;
}): React.JSX.Element {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  if (url === undefined || url === failedUrl) {
    return (
      <span className="training-photo-fallback">
        <Icon glyph={PersonSimpleRun} />
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- ver el comentario del componente.
    <img src={url} alt={alt} onError={() => setFailedUrl(url)} />
  );
}

function describeDose(
  translate: Translator,
  prescription: TrainingPrescription,
): string {
  const { sets, reps } = prescription;
  if (sets !== null && reps !== null) {
    return translate("training.member.doseSetsReps", { sets, reps });
  }
  return reps ?? (sets === null ? "" : String(sets));
}

function RowLoad({
  translate,
  load,
}: {
  readonly translate: Translator;
  readonly load: ResolvedLoad;
}): React.JSX.Element | null {
  switch (load.kind) {
    case "none":
      return null;
    case "text":
      return (
        <span className="training-load">
          <span className="training-load-main">{load.text}</span>
        </span>
      );
    case "kilos":
      return (
        <span className="training-load">
          <span className="training-load-main">
            {translate("training.member.kilos", { kilos: load.kilos })}
          </span>
          <span className="training-load-detail">
            {translate("training.member.pctOfMark", {
              pct: load.pct,
              mark: load.mark.name.toLocaleLowerCase(translate.locale),
              value: load.markValue,
            })}
          </span>
        </span>
      );
    case "missingMark":
      return (
        <span className="training-load">
          <span className="training-load-main training-load-warning">
            {translate("training.member.pct", { pct: load.pct })}
          </span>
          <span className="training-load-detail">
            {translate("training.member.addYourMark", {
              mark: load.mark.name.toLocaleLowerCase(translate.locale),
            })}
          </span>
        </span>
      );
  }
}

function RowPhotos({
  translate,
  row,
}: {
  readonly translate: Translator;
  readonly row: ExerciseRow;
}): React.JSX.Element | null {
  const { name, photoUrls } = row.exercise;
  const [start, end] = photoUrls;
  if (start === undefined) {
    return null;
  }
  if (end === undefined) {
    return (
      <div className="training-photos">
        <figure>
          <ExercisePhoto url={start} alt={name} />
        </figure>
      </div>
    );
  }
  const photos = [
    {
      url: start,
      caption: "training.member.photoStart",
      alt: "training.member.photoStartAlt",
    },
    {
      url: end,
      caption: "training.member.photoEnd",
      alt: "training.member.photoEndAlt",
    },
  ] as const;
  return (
    <div className="training-photos">
      {photos.map((photo) => (
        <figure key={photo.caption}>
          <ExercisePhoto
            url={photo.url}
            alt={translate(photo.alt, { exercise: name })}
          />
          <figcaption>{translate(photo.caption)}</figcaption>
        </figure>
      ))}
    </div>
  );
}

function RowDetails({
  translate,
  row,
  context,
  id,
}: {
  readonly translate: Translator;
  readonly row: ExerciseRow;
  readonly context: RowContext;
  readonly id: string;
}): React.JSX.Element {
  const mark = markUsedByRow(row, context.weekDose);
  const { tips, youtubeUrl } = row.exercise;
  return (
    <div id={id} className="training-exercise-details">
      {mark === null ? null : (
        <TrainingMarkField
          translate={translate}
          mark={mark}
          value={context.markValues.get(mark.id) ?? null}
          onSaveMark={context.onSaveMark}
        />
      )}
      <RowPhotos translate={translate} row={row} />
      {tips.length === 0 ? null : (
        <ul className="training-tips">
          {tips.map((tip) => (
            <li key={tip}>{tip}</li>
          ))}
        </ul>
      )}
      <a
        className="training-youtube"
        href={youtubeUrl}
        target="_blank"
        rel="noopener noreferrer"
      >
        <Icon glyph={YoutubeLogo} weight="fill" />
        {translate("training.member.watchOnYoutube")}
        <span className="visually-hidden">
          {translate("training.member.opensNewTab")}
        </span>
      </a>
    </div>
  );
}

export function TrainingExerciseRow({
  translate,
  row,
  context,
}: {
  readonly translate: Translator;
  readonly row: ExerciseRow;
  readonly context: RowContext;
}): React.JSX.Element {
  const [isOpen, setIsOpen] = useState(false);
  const detailsId = useId();
  const prescription = rowPrescription(row, context);
  const dose = describeDose(translate, prescription);
  return (
    <li className="training-exercise">
      <button
        type="button"
        className="training-exercise-row"
        aria-expanded={isOpen}
        aria-controls={isOpen ? detailsId : undefined}
        onClick={() => setIsOpen((previous) => !previous)}
      >
        <span className="training-thumbnail">
          <ExercisePhoto url={row.exercise.photoUrls[0]} alt="" />
        </span>
        <span className="training-exercise-text">
          <span className="training-exercise-name">{row.exercise.name}</span>
          <span className="training-exercise-dose">
            {dose}
            {row.rest === null ? null : (
              <span className="training-exercise-rest">
                {dose === "" ? null : " · "}
                {translate("training.member.doseRest", { rest: row.rest })}
              </span>
            )}
          </span>
          {row.note === null ? null : (
            <span className="training-exercise-note">{row.note}</span>
          )}
        </span>
        <RowLoad translate={translate} load={prescription.load} />
        <span className="training-exercise-caret">
          <Icon glyph={CaretDown} />
        </span>
      </button>
      {isOpen ? (
        <RowDetails
          translate={translate}
          row={row}
          context={context}
          id={detailsId}
        />
      ) : null}
    </li>
  );
}
