"use client";

import { IdentificationBadge } from "@phosphor-icons/react/dist/ssr/IdentificationBadge";
import { useId } from "react";
import { Icon } from "@/components/Icon";
import type { AttentionCounts, AufRenewal } from "@/lib/directory/directory";
import type { Translator } from "@/lib/i18n/translator";
import type { MoreFilters } from "./DirectoryFilterFields";
import type { StatusDotTone } from "./status-dots";

/**
 * Lo que falta en el club, en el resumen del panel (#551, RF-4 del PRD de
 * E21): la tarjeta del AUF por renovar y las cuatro filas de "Necesita
 * atención". Las dos filtran la lista; no mandan nada a nadie (D2: el
 * recordatorio por correo no se construye).
 *
 * Los números vienen del servidor y son de todo el club activo, así que no
 * cambian al filtrar: cada uno dice cuántas filas dará su filtro.
 */

type AttentionRow = {
  readonly counter: keyof AttentionCounts;
  readonly label:
    | "directory.overview.attention.aufMissing"
    | "directory.overview.attention.aufRenewal"
    | "directory.overview.attention.withoutEmergencyContact"
    | "directory.overview.attention.membershipPastDue";
  /** El tono del punto, el mismo que el de la fila de la lista (#549). */
  readonly tone: StatusDotTone;
  readonly isActive: (filters: MoreFilters) => boolean;
  /** Lo que pone en los filtros al activarla y al quitarla. */
  readonly on: Partial<MoreFilters>;
  readonly off: Partial<MoreFilters>;
};

const ATTENTION_ROWS: readonly AttentionRow[] = [
  {
    counter: "aufMissing",
    label: "directory.overview.attention.aufMissing",
    tone: "warning",
    isActive: (filters) => filters.auf === "missing",
    on: { auf: "missing" },
    off: { auf: null },
  },
  {
    counter: "aufRenewal",
    label: "directory.overview.attention.aufRenewal",
    tone: "danger",
    isActive: (filters) => filters.auf === "renewal",
    on: { auf: "renewal" },
    off: { auf: null },
  },
  {
    counter: "withoutEmergencyContact",
    label: "directory.overview.attention.withoutEmergencyContact",
    tone: "warning",
    isActive: (filters) => filters.withoutEmergencyContact,
    on: { withoutEmergencyContact: true },
    off: { withoutEmergencyContact: false },
  },
  {
    counter: "membershipPastDue",
    label: "directory.overview.attention.membershipPastDue",
    tone: "danger",
    isActive: (filters) => filters.membership === "past_due",
    on: { membership: "past_due" },
    off: { membership: null },
  },
];

function renewalLineOf(
  translate: Translator,
  renewals: readonly AufRenewal[],
): string {
  return renewals
    .map((renewal) =>
      translate(
        renewal.aufStatus === "expired"
          ? "directory.overview.aufExpired"
          : "directory.overview.aufExpiring",
        { name: renewal.fullName },
      ),
    )
    .join(", ");
}

export function AufRenewalCard({
  translate,
  renewals,
  onView,
}: {
  translate: Translator;
  renewals: readonly AufRenewal[];
  onView: () => void;
}): React.JSX.Element | null {
  const titleId = useId();
  if (renewals.length === 0) {
    return null;
  }
  return (
    <div
      className="directory-overview-auf"
      role="group"
      aria-labelledby={titleId}
    >
      <p className="directory-card-box-line">
        <Icon glyph={IdentificationBadge} />
        <strong id={titleId}>
          {translate("directory.overview.aufTitle", {
            count: renewals.length,
          })}
        </strong>
      </p>
      <p className="directory-overview-auf-names">
        {renewalLineOf(translate, renewals)}
      </p>
      <button
        type="button"
        className="admin-secondary directory-overview-view"
        aria-label={translate("directory.overview.viewLabel")}
        onClick={onView}
      >
        {translate("directory.overview.view")}
      </button>
    </div>
  );
}

export function NeedsAttention({
  translate,
  counts,
  filters,
  onFiltersChange,
}: {
  translate: Translator;
  counts: AttentionCounts;
  filters: MoreFilters;
  onFiltersChange: (filters: Partial<MoreFilters>) => void;
}): React.JSX.Element {
  const headingId = useId();
  return (
    <section
      className="directory-overview-section"
      role="group"
      aria-labelledby={headingId}
    >
      <h3 id={headingId} className="directory-card-label">
        {translate("directory.overview.attention")}
      </h3>
      <ul className="directory-overview-attention">
        {ATTENTION_ROWS.map((row) => {
          const isActive = row.isActive(filters);
          return (
            <li key={row.counter}>
              <button
                type="button"
                className="directory-overview-attention-row"
                aria-pressed={isActive}
                onClick={() => onFiltersChange(isActive ? row.off : row.on)}
              >
                <span
                  className={`directory-dot directory-dot-${row.tone}`}
                  aria-hidden="true"
                />
                <span className="directory-overview-attention-label">
                  {translate(row.label)}
                </span>{" "}
                <span className="directory-overview-count">
                  {counts[row.counter]}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
