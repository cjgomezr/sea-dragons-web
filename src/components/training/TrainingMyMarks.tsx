"use client";

import { LockSimple } from "@phosphor-icons/react/dist/ssr/LockSimple";
import { useId, useState } from "react";
import { Icon } from "@/components/Icon";
import type { Translator } from "@/lib/i18n/translator";
import type { MemberMark } from "@/lib/training/member-marks";
import { type MyMarksEntry, myMarksView } from "@/lib/training/my-marks-view";
import type { TrainingWeek } from "@/lib/training/training-plan";
import { useMarkDraft } from "./use-mark-draft";
import type { SaveMark } from "./use-member-marks";

/**
 * La tarjeta Mis marcas (#902, RF-5 y D11 del PRD de E35, §4.1 y §4.2 del
 * handoff): el 1RM del socio para cada marca del club, que solo ve él. Con
 * más de cuatro, las de la semana que se mira y un conmutador para el resto.
 */

function MyMarkField({
  translate,
  entry,
  onSaveMark,
}: {
  readonly translate: Translator;
  readonly entry: MyMarksEntry;
  readonly onSaveMark: SaveMark;
}): React.JSX.Element {
  const inputId = useId();
  const { mark } = entry;
  const { inputProps, error, errorId } = useMarkDraft({
    translate,
    markId: mark.id,
    value: mark.value,
    onSaveMark,
  });

  return (
    <li className="training-my-mark">
      <span className="training-my-mark-name">
        <label htmlFor={inputId}>{mark.name}</label>
        {entry.isThisWeek ? (
          <span className="training-my-mark-pill">
            {translate("training.member.thisWeek")}
          </span>
        ) : null}
      </span>
      <span className="training-mark-input training-my-mark-input">
        <input id={inputId} {...inputProps} />
        <span>{translate("training.member.markUnit")}</span>
      </span>
      {error === null ? null : (
        <p id={errorId} className="training-mark-error" role="alert">
          {translate(error)}
        </p>
      )}
    </li>
  );
}

export function TrainingMyMarks({
  translate,
  marks,
  week,
  onSaveMark,
}: {
  readonly translate: Translator;
  readonly marks: readonly MemberMark[];
  readonly week: TrainingWeek;
  readonly onSaveMark: SaveMark;
}): React.JSX.Element {
  const headingId = useId();
  const [showAll, setShowAll] = useState(false);
  const view = myMarksView({ marks, week, showAll });

  return (
    <section className="training-my-marks" aria-labelledby={headingId}>
      <div className="training-my-marks-top">
        <h2 id={headingId}>{translate("training.member.myMarks")}</h2>
        <span className="training-my-marks-count">
          {translate("training.member.marksSet", {
            set: view.setCount,
            total: view.total,
          })}
        </span>
        <span className="training-my-marks-private">
          <Icon glyph={LockSimple} />
          {translate("training.member.onlyYou")}
        </span>
      </div>
      <p className="training-my-marks-help">
        {translate("training.member.myMarksHelp")}
      </p>
      <ul className="training-my-marks-list">
        {view.entries.map((entry) => (
          <MyMarkField
            key={entry.mark.id}
            translate={translate}
            entry={entry}
            onSaveMark={onSaveMark}
          />
        ))}
      </ul>
      {view.toggle === "none" ? null : (
        <button
          type="button"
          className="training-my-marks-toggle"
          onClick={() => setShowAll(view.toggle === "showAll")}
        >
          {view.toggle === "showAll"
            ? translate("training.member.showAllMarks", { total: view.total })
            : translate("training.member.showWeekMarks")}
        </button>
      )}
    </section>
  );
}
