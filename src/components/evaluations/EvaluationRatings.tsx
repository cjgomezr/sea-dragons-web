import {
  type EvaluationRating,
  RATING_MAX,
  RATING_MIN,
} from "@/lib/evaluations/member-evaluation";
import type { EvaluationCategories } from "@/lib/evaluations/evaluation-categories";
import {
  type SheetRating,
  sheetRatings,
} from "@/lib/evaluations/sheet-ratings";
import type { Translator } from "@/lib/i18n/translator";

/**
 * Las categorías de una evaluación con su barra y su número, como el mockup
 * (#322), desde #819 con la rejilla del panel de E31. La barra es sólo
 * dibujo: lo que se lee, y lo que anuncia un lector de pantalla, es la
 * categoría y su número (PRD, accesibilidad). Al editar, cada barra pasa a
 * ser un deslizador con el mismo nombre y el número al lado.
 */

const RATINGS_HEADING_ID = "evaluation-ratings";
const PERCENT = 100;

/** Lo ajustado y sin guardar, por categoría. */
export type RatingsDraft = Readonly<Record<string, number>>;

export function draftOf(ratings: readonly EvaluationRating[]): RatingsDraft {
  return Object.fromEntries(
    ratings.map((entry) => [entry.categoryId, entry.rating]),
  );
}

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

function EditableRating({
  translate,
  entry,
  value,
  onChange,
}: {
  translate: Translator;
  entry: EvaluationRating;
  value: number;
  onChange: (value: number) => void;
}): React.JSX.Element {
  const id = sliderId(entry.categoryId);
  return (
    <li className="evaluation-rating">
      <span className="evaluation-rating-name">
        <label htmlFor={id}>{entry.name}</label>
        <RetiredTag translate={translate} entry={entry} />
      </span>
      <input
        id={id}
        type="range"
        className="evaluation-rating-slider"
        min={RATING_MIN}
        max={RATING_MAX}
        step={1}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      <output htmlFor={id} className="evaluation-rating-value">
        {value}
      </output>
    </li>
  );
}

function RatingsCard({
  translate,
  children,
}: {
  translate: Translator;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="card evaluation-ratings">
      <h3 id={RATINGS_HEADING_ID} className="evaluation-card-title">
        {translate("evaluations.ratings.title")}
      </h3>
      <ul
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

export function EvaluationRatings({
  translate,
  ratings,
  categories,
  draft,
  onDraftChange,
}: {
  translate: Translator;
  ratings: readonly EvaluationRating[];
  /** Las del club, para las que la evaluación no tiene; `null` si no se
   * pudieron leer. */
  categories: EvaluationCategories | null;
  /** `null` mientras no se edita. */
  draft: RatingsDraft | null;
  onDraftChange: (draft: RatingsDraft) => void;
}): React.JSX.Element {
  if (draft === null) {
    return (
      <ReadOnlyRatings
        translate={translate}
        rows={sheetRatings(ratings, categories)}
      />
    );
  }
  return (
    <RatingsCard translate={translate}>
      {ratings.map((entry) => (
        <EditableRating
          key={entry.categoryId}
          translate={translate}
          entry={entry}
          value={draft[entry.categoryId] ?? entry.rating}
          onChange={(value) =>
            onDraftChange({ ...draft, [entry.categoryId]: value })
          }
        />
      ))}
    </RatingsCard>
  );
}
