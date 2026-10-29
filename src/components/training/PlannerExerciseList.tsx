"use client";

import { Barbell } from "@phosphor-icons/react/dist/ssr/Barbell";
import { MagnifyingGlass } from "@phosphor-icons/react/dist/ssr/MagnifyingGlass";
import { Icon } from "@/components/Icon";
import type { MessageKey } from "@/lib/i18n/message";
import type { Translator } from "@/lib/i18n/translator";
import type {
  ExerciseSource,
  ManagedExercise,
} from "@/lib/training/club-exercises";
import { countOfSource } from "@/lib/training/exercise-planner-view";
import { exerciseUsage } from "./planner-exercises-format";
import type { PlannerExercises } from "./use-planner-exercises";

/**
 * La columna de la lista de Planificar → Ejercicios (#910; §5.1 "Tab
 * Exercises" y §5.2 del handoff): la búsqueda, las fichas All · Library ·
 * Club's own con su número, las filas y el crédito de las fotos. La lista
 * crece de 20 en 20 con Show more: la biblioteca son unos 800.
 */

/** Las fichas en su orden; nulo es All. */
const CHIPS: readonly (ExerciseSource | null)[] = [null, "library", "club"];

const CHIP_KEYS = {
  all: "training.exercises.all",
  library: "training.exercises.library",
  club: "training.exercises.club",
} as const satisfies Record<ExerciseSource | "all", MessageKey>;

const SOURCE_TAG_KEYS = {
  library: "training.exercises.sourceLibrary",
  club: "training.exercises.sourceClub",
} as const satisfies Record<ExerciseSource, MessageKey>;

function ExerciseFilters({
  translate,
  planner,
}: {
  readonly translate: Translator;
  readonly planner: PlannerExercises;
}): React.JSX.Element {
  const { state, filter } = planner;
  return (
    <div className="training-exercises-filters">
      <span className="training-exercises-search">
        <Icon glyph={MagnifyingGlass} />
        <input
          type="search"
          value={filter.text}
          aria-label={translate("training.exercises.search")}
          placeholder={translate("training.exercises.search")}
          autoComplete="off"
          onChange={(event) => planner.setText(event.target.value)}
        />
      </span>
      <div
        className="training-exercises-chips"
        role="group"
        aria-label={translate("training.exercises.filter")}
      >
        {CHIPS.map((source) => (
          <button
            key={source ?? "all"}
            type="button"
            className="training-exercises-chip"
            aria-pressed={filter.source === source}
            onClick={() => planner.setSource(source)}
          >
            {translate(CHIP_KEYS[source ?? "all"])}
            {state.kind === "ready" ? (
              <>
                {" "}
                <span className="training-exercises-chip-count">
                  {countOfSource(state.counts, source)}
                </span>
              </>
            ) : null}
          </button>
        ))}
      </div>
    </div>
  );
}

function ExerciseThumbnail({
  url,
}: {
  readonly url: string | null;
}): React.JSX.Element {
  if (url === null) {
    return (
      <span className="training-exercises-thumb">
        <Icon glyph={Barbell} />
      </span>
    );
  }
  // eslint-disable-next-line @next/next/no-img-element -- fotos de Storage, como las de la vista del socio.
  return <img className="training-exercises-thumb" src={url} alt="" />;
}

function ExerciseRow({
  translate,
  exercise,
  isOpen,
  onOpen,
}: {
  readonly translate: Translator;
  readonly exercise: ManagedExercise;
  readonly isOpen: boolean;
  readonly onOpen: (exercise: ManagedExercise) => void;
}): React.JSX.Element {
  return (
    <li className="training-exercises-row">
      <button
        type="button"
        className="training-exercises-row-button"
        aria-current={isOpen ? "true" : undefined}
        onClick={() => onOpen(exercise)}
      >
        <ExerciseThumbnail url={exercise.thumbnailUrl} />
        <span className="training-exercises-text">
          <span className="training-exercises-name">{exercise.name}</span>
          <span className="training-exercises-usage">
            {exerciseUsage(translate, exercise)}
          </span>
        </span>
        <span className="training-exercises-tag">
          {translate(SOURCE_TAG_KEYS[exercise.source])}
        </span>
      </button>
    </li>
  );
}

function EmptyList({
  translate,
  text,
}: {
  readonly translate: Translator;
  readonly text: string;
}): React.JSX.Element {
  return (
    <p className="admin-empty training-exercises-empty">
      {text === ""
        ? translate("training.exercises.empty")
        : translate("training.exercises.noMatch", { query: text })}
    </p>
  );
}

function ExerciseListBody({
  translate,
  planner,
  openId,
  onOpen,
}: {
  readonly translate: Translator;
  readonly planner: PlannerExercises;
  readonly openId: string | null;
  readonly onOpen: (exercise: ManagedExercise) => void;
}): React.JSX.Element {
  const { state } = planner;
  if (state.kind === "loading") {
    return (
      <p className="admin-empty">{translate("training.exercises.loading")}</p>
    );
  }
  if (state.kind === "failed") {
    return (
      <div className="admin-load-failure">
        <p className="auth-error" role="alert">
          {translate("training.exercises.failed")}
        </p>
        <button type="button" className="auth-submit" onClick={planner.retry}>
          {translate("training.manage.retry")}
        </button>
      </div>
    );
  }
  if (state.exercises.length === 0) {
    return <EmptyList translate={translate} text={state.text} />;
  }
  return (
    <div className="training-exercises-scroll">
      <ul
        className="training-exercises-list"
        aria-label={translate("training.exercises.list")}
      >
        {state.exercises.map((exercise) => (
          <ExerciseRow
            key={exercise.id}
            translate={translate}
            exercise={exercise}
            isOpen={exercise.id === openId}
            onOpen={onOpen}
          />
        ))}
      </ul>
      {state.nextOffset === null ? null : (
        <button
          type="button"
          className="training-plan-action training-exercises-more"
          onClick={() => void planner.loadMore()}
        >
          {translate("training.exercises.showMore")}
        </button>
      )}
    </div>
  );
}

export function PlannerExerciseList({
  translate,
  planner,
  openId,
  onOpen,
}: {
  readonly translate: Translator;
  readonly planner: PlannerExercises;
  /** El abierto a la derecha, o nulo. */
  readonly openId: string | null;
  readonly onOpen: (exercise: ManagedExercise) => void;
}): React.JSX.Element {
  return (
    <div className="training-exercises-browse">
      <ExerciseFilters translate={translate} planner={planner} />
      <ExerciseListBody
        translate={translate}
        planner={planner}
        openId={openId}
        onOpen={onOpen}
      />
      <p className="training-exercises-credit">
        {translate("training.exercises.credit")}
      </p>
    </div>
  );
}
