"use client";

import { X } from "@phosphor-icons/react/dist/ssr/X";
import { Icon } from "@/components/Icon";
import { positionName } from "@/lib/club/club-positions";
import type { DirectoryPositionFilter } from "@/lib/directory/directory";
import type { Locale } from "@/lib/i18n/locale";
import type { Translator } from "@/lib/i18n/translator";
import { type MoreFilters, NO_MORE_FILTERS } from "./DirectoryFilterFields";
import {
  AUF_FILTER_KEYS,
  MEMBERSHIP_FILTER_KEYS,
} from "./directory-filter-labels";
import type { FilterChoices } from "./use-filter-choices";

/**
 * Los filtros activos del directorio como fichas bajo la barra (#548):
 * "{filtro}: {valor}" y una ✕ que quita sólo ese, y al final "Borrar", que
 * los quita todos. Una casilla marcada no tiene valor que enseñar: su ficha
 * es su nombre.
 *
 * Cada ficha sale del mismo estado que los campos del popover, así que lo
 * que una ficha quita también se desmarca allí.
 */

/** Lo que se enseña mientras llegan las posiciones o los grupos del club, o
 * si el elegido ya no existe: la ficha sigue ahí para poder quitarla. */
const UNKNOWN_CHOICE = "…";

/** Un desplegable dice qué se eligió; una casilla marcada es sólo su
 * nombre. */
type FilterChip = {
  readonly id: keyof MoreFilters;
  readonly filter: string;
} & (
  | { readonly kind: "choice"; readonly value: string }
  | { readonly kind: "check" }
);

type ChipContext = {
  readonly translate: Translator;
  readonly locale: Locale;
  readonly choices: FilterChoices;
};

function positionLabel(
  position: DirectoryPositionFilter,
  { translate, locale, choices }: ChipContext,
): string {
  if (position.kind === "unassigned") {
    return translate("directory.filter.position.none");
  }
  const named = choices.positions?.find(
    (candidate) => candidate.id === position.positionId,
  );
  return named === undefined
    ? UNKNOWN_CHOICE
    : positionName(named.names, locale);
}

function groupLabel(groupId: string, { choices }: ChipContext): string {
  return (
    choices.groups?.find((group) => group.id === groupId)?.name ??
    UNKNOWN_CHOICE
  );
}

function isChip(chip: FilterChip | null): chip is FilterChip {
  return chip !== null;
}

/** Las fichas en el orden de los campos del popover. */
function chipsOf(
  filters: MoreFilters,
  context: ChipContext,
): readonly FilterChip[] {
  const { translate } = context;
  const chosen: readonly (FilterChip | null)[] = [
    filters.position === null
      ? null
      : {
          kind: "choice",
          id: "position",
          filter: translate("directory.filter.position"),
          value: positionLabel(filters.position, context),
        },
    filters.groupId === null
      ? null
      : {
          kind: "choice",
          id: "groupId",
          filter: translate("directory.filter.group"),
          value: groupLabel(filters.groupId, context),
        },
    filters.auf === null
      ? null
      : {
          kind: "choice",
          id: "auf",
          filter: translate("directory.filter.auf"),
          value: translate(AUF_FILTER_KEYS[filters.auf]),
        },
    filters.membership === null
      ? null
      : {
          kind: "choice",
          id: "membership",
          filter: translate("directory.filter.membership"),
          value: translate(MEMBERSHIP_FILTER_KEYS[filters.membership]),
        },
  ];
  return [...chosen.filter(isChip), ...checkedChipsOf(filters, translate)];
}

function checkedChipsOf(
  filters: MoreFilters,
  translate: Translator,
): readonly FilterChip[] {
  const checked: readonly FilterChip[] = [
    {
      id: "withoutPhone",
      filter: translate("directory.filter.withoutPhone"),
      kind: "check",
    },
    {
      id: "withoutEmergencyContact",
      filter: translate("directory.filter.withoutEmergencyContact"),
      kind: "check",
    },
    {
      id: "includeInactive",
      filter: translate("directory.includeInactive"),
      kind: "check",
    },
  ];
  return checked.filter((chip) => filters[chip.id] === true);
}

function chipName(chip: FilterChip, translate: Translator): string {
  return chip.kind === "check"
    ? chip.filter
    : translate("directory.filter.chip", {
        filter: chip.filter,
        value: chip.value,
      });
}

function Chip({
  chip,
  translate,
  onRemove,
}: {
  chip: FilterChip;
  translate: Translator;
  onRemove: () => void;
}): React.JSX.Element {
  const removeLabel = translate("directory.filter.chipRemove", {
    filter: chipName(chip, translate),
  });
  return (
    <li className="directory-chip">
      {chip.kind === "check" ? (
        chip.filter
      ) : (
        <>
          <span className="directory-chip-key">{`${chip.filter}:`}</span>{" "}
          {chip.value}
        </>
      )}
      <button
        type="button"
        className="directory-chip-remove"
        aria-label={removeLabel}
        title={removeLabel}
        onClick={onRemove}
      >
        <Icon glyph={X} />
      </button>
    </li>
  );
}

export function DirectoryFilterChips({
  translate,
  locale,
  filters,
  choices,
  onChange,
}: ChipContext & {
  filters: MoreFilters;
  onChange: (filters: MoreFilters) => void;
}): React.JSX.Element | null {
  const chips = chipsOf(filters, { translate, locale, choices });
  if (chips.length === 0) {
    return null;
  }
  return (
    <div className="directory-chips">
      <ul aria-label={translate("directory.filter.chips")}>
        {chips.map((chip) => (
          <Chip
            key={chip.id}
            chip={chip}
            translate={translate}
            onRemove={() =>
              onChange({ ...filters, [chip.id]: NO_MORE_FILTERS[chip.id] })
            }
          />
        ))}
      </ul>
      <button
        type="button"
        className="directory-link-button"
        onClick={() => onChange(NO_MORE_FILTERS)}
      >
        {translate("directory.filter.chipsClear")}
      </button>
    </div>
  );
}
