"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useDismissal } from "@/components/use-dismissal";
import { positionName } from "@/lib/club/club-positions";
import {
  AUF_FILTERS,
  type AufFilter,
  type DirectoryFilter,
  type DirectoryPositionFilter,
  type DirectoryQuery,
  MEMBERSHIP_FILTERS,
  type MembershipFilter,
} from "@/lib/directory/directory";
import type { Locale } from "@/lib/i18n/locale";
import type { MessageKey } from "@/lib/i18n/message";
import type { Translator } from "@/lib/i18n/translator";
import type { FilterChoices } from "./use-filter-choices";

/**
 * Los filtros por posición, grupo, AUF y membresía del directorio (#497, RF-4
 * del PRD de E19). Qué filtros se ofrecen lo dice el servidor al responder la
 * lista: un Committee recibe la vista de socio y aun así filtra por grupo.
 *
 * En escritorio van en la barra sobre la tabla. En el móvil no caben junto a
 * la búsqueda y los roles: van detrás de un botón "Filtros", con cuántos hay
 * activos, en una hoja que se abre desde abajo. Los dos se dibujan siempre y
 * el CSS enseña uno u otro; así el foco no depende de medir la pantalla.
 */

export type MoreFilters = Pick<
  DirectoryQuery,
  "position" | "groupId" | "auf" | "membership"
>;

export const NO_MORE_FILTERS: MoreFilters = {
  position: null,
  groupId: null,
  auf: null,
  membership: null,
};

/** "Sin filtrar" en un `<select>`, que sólo habla en textos. */
const ANY_VALUE = "";
const UNASSIGNED_POSITION_VALUE = "none";

const AUF_KEYS = {
  missing: "directory.filter.auf.missing",
  expired: "directory.filter.auf.expired",
  expiring: "directory.filter.auf.expiring",
  unverified: "directory.filter.auf.unverified",
} as const satisfies Record<AufFilter, MessageKey>;

const MEMBERSHIP_KEYS = {
  pending: "directory.filter.membership.pending",
  trialing: "directory.filter.membership.trialing",
  active: "directory.filter.membership.active",
  past_due: "directory.filter.membership.pastDue",
  cancelled: "directory.filter.membership.cancelled",
  waived: "directory.filter.membership.waived",
  none: "directory.filter.membership.none",
} as const satisfies Record<MembershipFilter, MessageKey>;

/** Los cuatro y ninguno más: quien llama puede pasar el estado entero de la
 * pantalla, con la búsqueda y el rol, que no cuentan en el botón. */
export function countActiveFilters({
  position,
  groupId,
  auf,
  membership,
}: MoreFilters): number {
  return [position, groupId, auf, membership].filter((value) => value !== null)
    .length;
}

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

type FieldsProps = {
  readonly translate: Translator;
  readonly locale: Locale;
  readonly filters: MoreFilters;
  readonly availableFilters: readonly DirectoryFilter[];
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
          label: translate(AUF_KEYS[auf]),
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
          label: translate(MEMBERSHIP_KEYS[membership]),
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

/** Los mismos campos en la barra y en la hoja, en el orden del ticket. */
function FilterFields(props: FieldsProps): React.JSX.Element {
  const offers = (filter: DirectoryFilter): boolean =>
    props.availableFilters.includes(filter);
  return (
    <>
      {offers("position") ? <PositionField {...props} /> : null}
      {offers("group") ? <GroupField {...props} /> : null}
      {offers("auf") ? <AufField {...props} /> : null}
      {offers("membership") ? <MembershipField {...props} /> : null}
    </>
  );
}

/** La hoja del móvil: un `<dialog>` modal, como el visor de la foto (#355),
 * con lo que comparte con él por `useDismissal`. Cerrarla devuelve el foco
 * al botón que la abrió. */
function FilterSheet({
  fields,
  translate,
  onClosed,
}: {
  fields: FieldsProps;
  translate: Translator;
  onClosed: () => void;
}): React.JSX.Element {
  const titleId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const focusFirstField = useCallback(() => {
    panelRef.current?.querySelector<HTMLElement>("select, button")?.focus();
  }, []);

  useEffect(() => {
    dialogRef.current?.showModal();
    focusFirstField();
  }, [focusFirstField]);

  const close = useCallback(() => dialogRef.current?.close(), []);
  const pressOutside = useCallback(
    (event: MouseEvent) => {
      event.preventDefault();
      close();
    },
    [close],
  );
  const keepFocusInside = useCallback(() => {
    if (dialogRef.current?.open === true) {
      focusFirstField();
    }
  }, [focusFirstField]);
  useDismissal({
    isOpen: true,
    containerRef: panelRef,
    onEscape: close,
    onPressOutside: pressOutside,
    onFocusOutside: keepFocusInside,
  });

  return (
    <dialog
      ref={dialogRef}
      className="directory-sheet"
      aria-labelledby={titleId}
      onClose={onClosed}
    >
      <div ref={panelRef} className="directory-sheet-panel">
        <h2 id={titleId} className="directory-sheet-title">
          {translate("directory.filter.sheetTitle")}
        </h2>
        <div className="directory-sheet-fields">
          <FilterFields {...fields} />
        </div>
        <button type="button" className="auth-submit" onClick={close}>
          {translate("directory.filter.apply")}
        </button>
      </div>
    </dialog>
  );
}

export function DirectoryMoreFilters(props: FieldsProps): React.JSX.Element {
  const { translate, filters } = props;
  const [isSheetOpen, setIsSheetOpen] = useState(false);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const activeCount = countActiveFilters(filters);

  const closeSheet = useCallback(() => {
    setIsSheetOpen(false);
    toggleRef.current?.focus();
  }, []);

  return (
    <>
      <div
        role="group"
        aria-label={translate("directory.filter.legend")}
        className="directory-filter-bar"
      >
        <FilterFields {...props} />
      </div>
      <button
        ref={toggleRef}
        type="button"
        className="admin-secondary directory-filter-toggle"
        aria-haspopup="dialog"
        aria-label={
          activeCount === 0
            ? undefined
            : translate("directory.filter.toggleActive", {
                count: activeCount,
              })
        }
        onClick={() => setIsSheetOpen(true)}
      >
        {translate("directory.filter.toggle")}
        {activeCount === 0 ? null : (
          <span className="directory-filter-count" aria-hidden="true">
            {activeCount}
          </span>
        )}
      </button>
      {isSheetOpen ? (
        <FilterSheet
          fields={props}
          translate={translate}
          onClosed={closeSheet}
        />
      ) : null}
    </>
  );
}
