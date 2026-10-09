"use client";

import { useId } from "react";
import { positionName } from "@/lib/club/club-positions";
import {
  AUF_FILTERS,
  type DirectoryFilter,
  type DirectoryPositionFilter,
  type DirectoryQuery,
  MEMBERSHIP_FILTERS,
} from "@/lib/directory/directory";
import type { Locale } from "@/lib/i18n/locale";
import type { Translator } from "@/lib/i18n/translator";
import {
  AUF_FILTER_KEYS,
  MEMBERSHIP_FILTER_KEYS,
} from "./directory-filter-labels";
import type { FilterChoices } from "./use-filter-choices";

/**
 * Los campos de los filtros del directorio: posición, grupo, AUF y membresía
 * (#497), los de quien no tiene teléfono o contacto de emergencia (#499) y,
 * sólo para un Admin, los dados de baja (AC-040). Qué filtros se ofrecen lo
 * dice el servidor al responder la lista, no la marca de la vista: un Coach
 * recibe la suya y filtra por grupo, pero no por lo que le falta a cada
 * contacto.
 *
 * Los mismos campos van en el popover de escritorio y en la hoja del móvil
 * (#548): los desplegables por un lado y las casillas por otro, porque el
 * popover los pone en bloques distintos.
 */

export type MoreFilters = Pick<
  DirectoryQuery,
  | "position"
  | "groupId"
  | "auf"
  | "membership"
  | "withoutPhone"
  | "withoutEmergencyContact"
  | "includeInactive"
>;

export const NO_MORE_FILTERS: MoreFilters = {
  position: null,
  groupId: null,
  auf: null,
  membership: null,
  withoutPhone: false,
  withoutEmergencyContact: false,
  includeInactive: false,
};

/** Los siete y ninguno más: quien llama puede pasar el estado entero de la
 * pantalla, con la búsqueda y el rol, que no cuentan en el botón. */
export function countActiveFilters({
  position,
  groupId,
  auf,
  membership,
  withoutPhone,
  withoutEmergencyContact,
  includeInactive,
}: MoreFilters): number {
  const chosen = [position, groupId, auf, membership].filter(
    (value) => value !== null,
  ).length;
  const checked = [
    withoutPhone,
    withoutEmergencyContact,
    includeInactive,
  ].filter((isChecked) => isChecked).length;
  return chosen + checked;
}

/** "Sin filtrar" en un `<select>`, que sólo habla en textos. */
const ANY_VALUE = "";
const UNASSIGNED_POSITION_VALUE = "none";

function positionValue(position: DirectoryPositionFilter | null): string {
  if (position === null) {
    return ANY_VALUE;
  }
  return position.kind === "unassigned"
    ? UNASSIGNED_POSITION_VALUE
    : position.positionId;
}

function readPosition(value: string): DirectoryPositionFilter | null {
  if (value === ANY_VALUE) {
    return null;
  }
  return value === UNASSIGNED_POSITION_VALUE
    ? { kind: "unassigned" }
    : { kind: "position", positionId: value };
}

/** El valor elegido, de vuelta al catálogo del que salieron las opciones. */
function readChoice<T extends string>(
  catalog: readonly T[],
  value: string,
): T | null {
  return catalog.find((entry) => entry === value) ?? null;
}

type Option = { readonly value: string; readonly label: string };

function FilterSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: readonly Option[];
  onChange: (value: string) => void;
}): React.JSX.Element {
  const id = useId();
  return (
    <div className="auth-field directory-filter">
      <label htmlFor={id}>{label}</label>
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

export type FieldsProps = {
  readonly translate: Translator;
  readonly locale: Locale;
  readonly filters: MoreFilters;
  readonly availableFilters: readonly DirectoryFilter[];
  /** Sólo un Admin puede pedir a los dados de baja (AC-040), y el servidor lo
   * dice al responder la lista. Para el resto la casilla no existe. */
  readonly canIncludeInactive: boolean;
  readonly choices: FilterChoices;
  readonly onChange: (filters: MoreFilters) => void;
};

function PositionField({
  translate,
  locale,
  filters,
  choices,
  onChange,
}: FieldsProps): React.JSX.Element | null {
  if (choices.positions === null) {
    return null;
  }
  return (
    <FilterSelect
      label={translate("directory.filter.position")}
      value={positionValue(filters.position)}
      options={[
        { value: ANY_VALUE, label: translate("directory.filter.position.all") },
        ...choices.positions.map((position) => ({
          value: position.id,
          label: positionName(position.names, locale),
        })),
        {
          value: UNASSIGNED_POSITION_VALUE,
          label: translate("directory.filter.position.none"),
        },
      ]}
      onChange={(value) =>
        onChange({ ...filters, position: readPosition(value) })
      }
    />
  );
}

function GroupField({
  translate,
  filters,
  choices,
  onChange,
}: FieldsProps): React.JSX.Element | null {
  if (choices.groups === null) {
    return null;
  }
  return (
    <FilterSelect
      label={translate("directory.filter.group")}
      value={filters.groupId ?? ANY_VALUE}
      options={[
        { value: ANY_VALUE, label: translate("directory.filter.group.all") },
        ...choices.groups.map((group) => ({
          value: group.id,
          label: group.name,
        })),
      ]}
      onChange={(value) =>
        onChange({ ...filters, groupId: value === ANY_VALUE ? null : value })
      }
    />
  );
}

function AufField({
  translate,
  filters,
  onChange,
}: FieldsProps): React.JSX.Element {
  return (
    <FilterSelect
      label={translate("directory.filter.auf")}
      value={filters.auf ?? ANY_VALUE}
      options={[
        { value: ANY_VALUE, label: translate("directory.filter.auf.all") },
        ...AUF_FILTERS.map((auf) => ({
          value: auf,
          label: translate(AUF_FILTER_KEYS[auf]),
        })),
      ]}
      onChange={(value) =>
        onChange({ ...filters, auf: readChoice(AUF_FILTERS, value) })
      }
    />
  );
}

function MembershipField({
  translate,
  filters,
  onChange,
}: FieldsProps): React.JSX.Element {
  return (
    <FilterSelect
      label={translate("directory.filter.membership")}
      value={filters.membership ?? ANY_VALUE}
      options={[
        {
          value: ANY_VALUE,
          label: translate("directory.filter.membership.all"),
        },
        ...MEMBERSHIP_FILTERS.map((membership) => ({
          value: membership,
          label: translate(MEMBERSHIP_FILTER_KEYS[membership]),
        })),
      ]}
      onChange={(value) =>
        onChange({
          ...filters,
          membership: readChoice(MEMBERSHIP_FILTERS, value),
        })
      }
    />
  );
}

/** Una casilla y su etiqueta, con un `id` propio de cada instancia. */
function FilterCheckbox({
  label,
  isChecked,
  onChange,
}: {
  label: string;
  isChecked: boolean;
  onChange: (isChecked: boolean) => void;
}): React.JSX.Element {
  const id = useId();
  return (
    <div className="auth-consent directory-filter directory-filter-check">
      <input
        id={id}
        type="checkbox"
        checked={isChecked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <label htmlFor={id}>{label}</label>
    </div>
  );
}

function offers(props: FieldsProps, filter: DirectoryFilter): boolean {
  return props.availableFilters.includes(filter);
}

/** Los desplegables, en el orden del ticket. */
export function SelectFields(props: FieldsProps): React.JSX.Element {
  return (
    <>
      {offers(props, "position") ? <PositionField {...props} /> : null}
      {offers(props, "group") ? <GroupField {...props} /> : null}
      {offers(props, "auf") ? <AufField {...props} /> : null}
      {offers(props, "membership") ? <MembershipField {...props} /> : null}
    </>
  );
}

/** Las casillas: lo que le falta al contacto y los dados de baja. */
export function CheckFields(props: FieldsProps): React.JSX.Element {
  const { translate, filters, onChange } = props;
  return (
    <>
      {offers(props, "withoutPhone") ? (
        <FilterCheckbox
          label={translate("directory.filter.withoutPhone")}
          isChecked={filters.withoutPhone}
          onChange={(withoutPhone) => onChange({ ...filters, withoutPhone })}
        />
      ) : null}
      {offers(props, "withoutEmergencyContact") ? (
        <FilterCheckbox
          label={translate("directory.filter.withoutEmergencyContact")}
          isChecked={filters.withoutEmergencyContact}
          onChange={(withoutEmergencyContact) =>
            onChange({ ...filters, withoutEmergencyContact })
          }
        />
      ) : null}
      {props.canIncludeInactive ? (
        <FilterCheckbox
          label={translate("directory.includeInactive")}
          isChecked={filters.includeInactive}
          onChange={(includeInactive) =>
            onChange({ ...filters, includeInactive })
          }
        />
      ) : null}
    </>
  );
}
