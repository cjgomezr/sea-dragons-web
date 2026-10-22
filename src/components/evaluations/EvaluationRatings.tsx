import { Minus } from "@phosphor-icons/react/dist/ssr/Minus";
import { Plus } from "@phosphor-icons/react/dist/ssr/Plus";
import { useEffect, useRef } from "react";
import { Icon } from "@/components/Icon";
import {
  type EvaluationRating,
  RATING_MAX,
  RATING_MIN,
} from "@/lib/evaluations/member-evaluation";
import type { EvaluationCategories } from "@/lib/evaluations/evaluation-categories";
import {
  type EditingRating,
  type SheetRating,
  sheetRatings,
} from "@/lib/evaluations/sheet-ratings";
import type { Translator } from "@/lib/i18n/translator";
import type { EvaluationsLayout } from "./evaluations-layout";

/**
 * Las categorías de una evaluación con su barra y su número, como el mockup
 * (#322), desde #819 con la rejilla del panel de E31. La barra es sólo
 * dibujo: lo que se lee, y lo que anuncia un lector de pantalla, es la
 * categoría y su número (PRD, accesibilidad). Al editar (#820), cada
 * categoría activa lleva un deslizador nativo con su etiqueta y el número al
 * lado, que cambia mientras se mueve. En el móvil (#822) el deslizador va
 * entre − y +, que bajan y suben de uno en uno.
 */

const RATINGS_HEADING_ID = "evaluation-ratings";
const PERCENT = 100;

function sliderId(categoryId: string): string {
  return `evaluation-rating-${categoryId}`;
}

function RetiredTag({
  translate,
  entry,
}: {
  translate: Translator;
  entry: EvaluationRating;
}): React.JSX.Element | null {
  return entry.isRetired ? (
    <span className="evaluation-rating-retired">
      {translate("evaluations.ratings.retired")}
    </span>
  ) : null;
}

function RatingBar({ rating }: { rating: number }): React.JSX.Element {
  return (
    <span className="evaluation-rating-bar" aria-hidden="true">
      <span
        className="evaluation-rating-fill"
        style={{ width: `${(rating / RATING_MAX) * PERCENT}%` }}
      />
    </span>
  );
}

function ReadOnlyRating({
  translate,
  entry,
}: {
  translate: Translator;
  entry: EvaluationRating;
}): React.JSX.Element {
  return (
    <li className="evaluation-rating">
      <span className="evaluation-rating-name">
        {entry.name}
        <RetiredTag translate={translate} entry={entry} />
      </span>
      <RatingBar rating={entry.rating} />
      <span className="evaluation-rating-value">
        {entry.rating}
        <span className="visually-hidden">
          {translate("evaluations.ratings.outOf", { max: RATING_MAX })}
        </span>
      </span>
    </li>
  );
}

function RatingSlider({
  id,
  row,
  onChange,
}: {
  id: string;
  row: EditingRating;
  onChange: (value: number) => void;
}): React.JSX.Element {
  return (
    <input
      id={id}
      type="range"
      className="evaluation-rating-slider"
      min={RATING_MIN}
      max={RATING_MAX}
      step={1}
      value={row.rating}
      onChange={(event) => onChange(Number(event.target.value))}
    />
  );
}

function StepButton({
  label,
  glyph,
  target,
  onChange,
}: {
  label: string;
  glyph: React.ReactNode;
  target: number;
  onChange: (value: number) => void;
}): React.JSX.Element {
  const isOutOfRange = target < RATING_MIN || target > RATING_MAX;
  return (
    <button
      type="button"
      className="evaluation-rating-step"
      aria-label={label}
      disabled={isOutOfRange}
      onClick={() => onChange(target)}
    >
      {glyph}
    </button>
  );
}

/** − [deslizador] +, con los botones deshabilitados en 1 y en 10. */
function RatingStepper({
  translate,
  id,
  row,
  onChange,
}: {
  translate: Translator;
  id: string;
  row: EditingRating;
  onChange: (value: number) => void;
}): React.JSX.Element {
  return (
    <span className="evaluation-rating-stepper">
      <StepButton
        label={translate("evaluations.ratings.lower", { category: row.name })}
        glyph={<Icon glyph={Minus} weight="bold" />}
        target={row.rating - 1}
        onChange={onChange}
      />
      <RatingSlider id={id} row={row} onChange={onChange} />
      <StepButton
        label={translate("evaluations.ratings.raise", { category: row.name })}
        glyph={<Icon glyph={Plus} weight="bold" />}
        target={row.rating + 1}
        onChange={onChange}
      />
    </span>
  );
}

function EditableRating({
  translate,
  row,
  layout,
  onChange,
}: {
  translate: Translator;
  row: EditingRating;
  layout: EvaluationsLayout;
  onChange: (value: number) => void;
}): React.JSX.Element {
  const id = sliderId(row.categoryId);
  return (
    <li className="evaluation-rating">
      <span className="evaluation-rating-name">
        <label htmlFor={id}>{row.name}</label>
      </span>
      {layout === "compact" ? (
        <RatingStepper
          translate={translate}
          id={id}
          row={row}
          onChange={onChange}
        />
      ) : (
        <RatingSlider id={id} row={row} onChange={onChange} />
      )}
      <output htmlFor={id} className="evaluation-rating-value">
        {row.rating}
      </output>
    </li>
  );
}

function RatingsCard({
  translate,
  listRef,
  children,
}: {
  translate: Translator;
  listRef?: React.Ref<HTMLUListElement>;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="evaluation-ratings">
      <h3 id={RATINGS_HEADING_ID} className="evaluation-card-title">
        {translate("evaluations.ratings.title")}
      </h3>
      <ul
        ref={listRef}
        className="evaluation-rating-list"
        aria-labelledby={RATINGS_HEADING_ID}
      >
        {children}
      </ul>
    </div>
  );
}

function UnratedRating({
  translate,
  name,
}: {
  translate: Translator;
  name: string;
}): React.JSX.Element {
  return (
    <li className="evaluation-rating" data-unrated="true">
      <span className="evaluation-rating-name">{name}</span>
      <span className="evaluation-rating-unrated">
        {translate("evaluations.ratings.unrated")}
      </span>
      <span className="evaluation-rating-value" aria-hidden="true">
        —
      </span>
    </li>
  );
}

/** En lectura, en el orden de Categorías y con las que faltan como "nueva ·
 * sin nota" (#819, D3). */
function ReadOnlyRatings({
  translate,
  rows,
}: {
  translate: Translator;
  rows: readonly SheetRating[];
}): React.JSX.Element {
  return (
    <RatingsCard translate={translate}>
      {rows.map((row) =>
        row.kind === "rated" ? (
          <ReadOnlyRating
            key={row.entry.categoryId}
            translate={translate}
            entry={row.entry}
          />
        ) : (
          <UnratedRating
            key={row.categoryId}
            translate={translate}
            name={row.name}
          />
        ),
      )}
    </RatingsCard>
  );
}

/** Al entrar en edición el botón que se pulsó desaparece (Editar notas,
 * Empezar evaluación, Guardar y siguiente): el foco pasa al primer
 * deslizador, que es por donde se sigue. */
function EditingRatings({
  translate,
  rows,
  layout,
  onRatingChange,
}: {
  translate: Translator;
  rows: readonly EditingRating[];
  layout: EvaluationsLayout;
  onRatingChange: (categoryId: string, rating: number) => void;
}): React.JSX.Element {
  const listRef = useRef<HTMLUListElement>(null);
  useEffect(() => {
    listRef.current?.querySelector("input")?.focus();
  }, []);
  return (
    <RatingsCard translate={translate} listRef={listRef}>
      {rows.map((row) => (
        <EditableRating
          key={row.categoryId}
          translate={translate}
          row={row}
          layout={layout}
          onChange={(value) => onRatingChange(row.categoryId, value)}
        />
      ))}
    </RatingsCard>
  );
}

export function EvaluationRatings({
  translate,
  ratings,
  categories,
  editingRows,
  layout,
  onRatingChange,
}: {
  translate: Translator;
  ratings: readonly EvaluationRating[];
  /** Las del club, para las que la evaluación no tiene; `null` si no se
   * pudieron leer. */
  categories: EvaluationCategories | null;
  /** Las de la edición con su valor de ahora; `null` mientras no se edita. */
  editingRows: readonly EditingRating[] | null;
  layout: EvaluationsLayout;
  onRatingChange: (categoryId: string, rating: number) => void;
}): React.JSX.Element {
  if (editingRows === null) {
    return (
      <ReadOnlyRatings
        translate={translate}
        rows={sheetRatings(ratings, categories)}
      />
    );
  }
  return (
    <EditingRatings
      translate={translate}
      rows={editingRows}
      layout={layout}
      onRatingChange={onRatingChange}
    />
  );
}
