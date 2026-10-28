import { Archive } from "@phosphor-icons/react/dist/ssr/Archive";
import { CheckCircle } from "@phosphor-icons/react/dist/ssr/CheckCircle";
import { Copy } from "@phosphor-icons/react/dist/ssr/Copy";
import { Icon } from "@/components/Icon";
import type { Translator } from "@/lib/i18n/translator";
import type { ManagedCycle } from "@/lib/training/club-cycles";
import type { PlannerCycles } from "./use-planner-cycles";

/**
 * Lo que se le hace a un ciclo entero (#906, RF-7): Make active solo a un
 * borrador, Duplicate a cualquiera y Archive a lo que no está archivado. En
 * el móvil Archive es solo el icono, con su nombre para quien no lo ve.
 */

export function PlannerCycleActions({
  translate,
  cycle,
  planner,
  isCompact,
}: {
  readonly translate: Translator;
  readonly cycle: ManagedCycle;
  readonly planner: Pick<
    PlannerCycles,
    "activate" | "duplicate" | "archive" | "isBusy"
  >;
  /** En el móvil, Archive va como icono. */
  readonly isCompact: boolean;
}): React.JSX.Element {
  const archiveLabel = translate("training.manage.archive");
  return (
    <>
      {cycle.status === "draft" ? (
        <button
          type="button"
          className="training-plan-action training-plan-action-activate"
          disabled={planner.isBusy}
          onClick={() => planner.activate(cycle)}
        >
          <Icon glyph={CheckCircle} />
          {translate("training.manage.makeActive")}
        </button>
      ) : null}
      <button
        type="button"
        className="training-plan-action"
        disabled={planner.isBusy}
        onClick={() => planner.duplicate(cycle)}
      >
        <Icon glyph={Copy} />
        {translate("training.manage.duplicate")}
      </button>
      {cycle.status === "archived" ? null : (
        <button
          type="button"
          className="training-plan-action training-plan-action-archive"
          disabled={planner.isBusy}
          aria-label={isCompact ? archiveLabel : undefined}
          onClick={() => planner.archive(cycle)}
        >
          <Icon glyph={Archive} />
          {isCompact ? null : archiveLabel}
        </button>
      )}
    </>
  );
}
