"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { type AudienceChoice, AudienceField } from "@/components/AudienceField";
import { GROUPS_PATH } from "@/lib/auth/routes";
import type { Translator } from "@/lib/i18n/translator";
import type {
  ConflictingCycle,
  CycleAudienceInput,
  ManagedCycle,
} from "@/lib/training/club-cycles";
import { PlannerInlineConfirm } from "./PlannerInlineConfirm";
import { conflictsConfirmText } from "./planner-format";
import type { PlannerGroups } from "./use-planner-groups";
import type { PlannerCycles } from "./use-planner-cycles";

/**
 * Para quién es un ciclo (#980, RF-5 del PRD de E38): todo el club o los
 * grupos que se marquen. A diferencia de los otros campos no se guarda al
 * salir, sino con Save: marcar grupos de uno en uno haría un viaje (y quizá
 * una confirmación) por cada casilla. Si el cambio choca con otros activos,
 * la API dice cuáles y se confirma antes de archivarlos (D3).
 */

type AudiencePlanner = Pick<PlannerCycles, "save">;

function choiceOf(cycle: ManagedCycle): AudienceChoice {
  return cycle.audience.kind === "club"
    ? { kind: "club", groupIds: new Set() }
    : {
        kind: "groups",
        groupIds: new Set(cycle.audience.groups.map((group) => group.id)),
      };
}

function isSameChoice(left: AudienceChoice, right: AudienceChoice): boolean {
  if (left.kind !== right.kind) {
    return false;
  }
  return (
    left.kind === "club" ||
    (left.groupIds.size === right.groupIds.size &&
      [...left.groupIds].every((id) => right.groupIds.has(id)))
  );
}

function inputOf(choice: AudienceChoice): CycleAudienceInput {
  return choice.kind === "club"
    ? { kind: "club" }
    : { kind: "groups", groupIds: [...choice.groupIds] };
}

function GroupsHint({
  translate,
}: {
  readonly translate: Translator;
}): React.JSX.Element {
  return (
    <p className="training-plan-audience-hint">
      <Link href={GROUPS_PATH}>
        {translate("training.manage.audienceGroupsLink")}
      </Link>
    </p>
  );
}

/** Mientras llegan los grupos, o si no llegan, la leyenda con lo que pasa. */
function PendingGroups({
  translate,
  groups,
}: {
  readonly translate: Translator;
  readonly groups: Exclude<PlannerGroups, { readonly kind: "ready" }>;
}): React.JSX.Element {
  return (
    <fieldset className="member-record-groups news-audience">
      <legend>{translate("training.manage.audienceLegend")}</legend>
      <p className="auth-note">
        {groups.kind === "loading"
          ? translate("training.manage.audienceGroupsLoading")
          : translate("training.manage.audienceGroupsFailed")}
      </p>
    </fieldset>
  );
}

function useAudienceDraft(cycle: ManagedCycle): {
  readonly draft: AudienceChoice;
  readonly setDraft: (choice: AudienceChoice) => void;
} {
  const [draft, setDraft] = useState<AudienceChoice>(() => choiceOf(cycle));
  const [shownCycle, setShownCycle] = useState(cycle);
  // Lo que responde el servidor sólo pisa el borrador si nadie lo tocó.
  if (shownCycle !== cycle) {
    if (isSameChoice(draft, choiceOf(shownCycle))) {
      setDraft(choiceOf(cycle));
    }
    setShownCycle(cycle);
  }
  return { draft, setDraft };
}

export function PlannerCycleAudience({
  translate,
  cycle,
  groups,
  planner,
}: {
  readonly translate: Translator;
  readonly cycle: ManagedCycle;
  readonly groups: PlannerGroups;
  readonly planner: AudiencePlanner;
}): React.JSX.Element {
  const { draft, setDraft } = useAudienceDraft(cycle);
  const [isMissingGroups, setIsMissingGroups] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [conflicts, setConflicts] = useState<
    readonly ConflictingCycle[] | null
  >(null);
  const saveRef = useRef<HTMLButtonElement>(null);

  if (groups.kind !== "ready") {
    return <PendingGroups translate={translate} groups={groups} />;
  }

  async function save(confirmConflicts: boolean): Promise<void> {
    if (draft.kind === "groups" && draft.groupIds.size === 0) {
      setIsMissingGroups(true);
      return;
    }
    setIsSaving(true);
    const result = await planner.save({
      cycleId: cycle.id,
      changes: { audience: inputOf(draft) },
      confirmRemoval: false,
      confirmConflicts,
    });
    setIsSaving(false);
    if (result.kind === "conflicts") {
      setConflicts(result.conflicts);
    }
  }

  function closeConflicts(): void {
    setConflicts(null);
    saveRef.current?.focus();
  }

  const isArchived = cycle.status === "archived";
  const isDirty = !isSameChoice(draft, choiceOf(cycle));
  return (
    <div className="training-plan-audience">
      <AudienceField
        translate={translate}
        legend={translate("training.manage.audienceLegend")}
        clubGroups={groups.groups}
        audience={draft}
        issueText={
          isMissingGroups
            ? translate("training.manage.audienceGroupsRequired")
            : null
        }
        isDisabled={isArchived}
        onChange={(choice) => {
          setIsMissingGroups(false);
          setDraft(choice);
        }}
      />
      {groups.groups.length === 0 ? <GroupsHint translate={translate} /> : null}
      {isDirty && !isArchived ? (
        <button
          ref={saveRef}
          type="button"
          className="training-plan-action training-plan-audience-save"
          disabled={isSaving}
          onClick={() => void save(false)}
        >
          {translate("training.manage.audienceSave")}
        </button>
      ) : null}
      {conflicts === null ? null : (
        <PlannerInlineConfirm
          translate={translate}
          text={conflictsConfirmText(translate, conflicts)}
          classNames={{
            box: "training-plan-cycle-conflicts",
            confirm: "training-plan-action training-plan-action-activate",
          }}
          confirmLabel={translate("training.manage.audienceSave")}
          isBusy={isSaving}
          onCancel={closeConflicts}
          onConfirm={() => {
            setConflicts(null);
            void save(true);
          }}
        />
      )}
    </div>
  );
}
