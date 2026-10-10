"use client";

import { CaretDoubleRight } from "@phosphor-icons/react/dist/ssr/CaretDoubleRight";
import { Icon } from "@/components/Icon";
import type { ClubSummary, DirectoryMember } from "@/lib/directory/directory";
import type { Locale } from "@/lib/i18n/locale";
import type { Translator } from "@/lib/i18n/translator";
import { AdministrationNotice } from "./AdministrationNotice";
import type { MoreFilters } from "./DirectoryFilterFields";
import { AufRenewalCard, NeedsAttention } from "./OverviewAttention";
import { OverviewRoleRequests } from "./OverviewRoleRequests";
import type { PendingRoleRequests } from "./use-pending-role-requests";

/**
 * El resumen del club en el panel lateral del Admin (#551, RF-4 del PRD de
 * E21), lo que el panel enseña sin nadie elegido: las solicitudes de rol, el
 * AUF por renovar y lo que falta. Medidas: "State A" de
 * `docs/design/directorio-admin/README.md`.
 *
 * Sólo lo ve un Admin (D4): la pantalla lo monta cuando su lista llega
 * marcada `admin`, que es la única que trae el resumen.
 */

/** Lo que el resumen necesita de la pantalla. */
export type OverviewContext = {
  readonly summary: ClubSummary;
  readonly pendingRequests: PendingRoleRequests;
  /** La lista que se ve, para la foto de quien pide un rol. */
  readonly members: readonly DirectoryMember[];
  readonly filters: MoreFilters;
  readonly onFiltersChange: (filters: Partial<MoreFilters>) => void;
  readonly onSelectMember: (userId: string) => void;
};

function OverviewHeader({
  translate,
  onClose,
}: {
  translate: Translator;
  onClose: () => void;
}): React.JSX.Element {
  const closeLabel = translate("directory.panel.close");
  return (
    <header className="directory-card-header">
      <div className="directory-identity">
        <h2 className="directory-card-name">
          {translate("directory.overview.title")}
        </h2>
        <p className="directory-meta">
          {translate("directory.overview.subtitle")}
        </p>
      </div>
      <button
        type="button"
        className="directory-card-close"
        aria-label={closeLabel}
        title={closeLabel}
        onClick={onClose}
      >
        <Icon glyph={CaretDoubleRight} />
      </button>
    </header>
  );
}

export function ClubOverview({
  translate,
  locale,
  overview,
  onClose,
}: {
  translate: Translator;
  locale: Locale;
  overview: OverviewContext;
  onClose: () => void;
}): React.JSX.Element {
  const { summary, pendingRequests, filters, onFiltersChange } = overview;
  return (
    <>
      <OverviewHeader translate={translate} onClose={onClose} />
      <AdministrationNotice notice={pendingRequests.notice} />
      {pendingRequests.state.kind === "ready" ? (
        <OverviewRoleRequests
          translate={translate}
          locale={locale}
          requests={pendingRequests.state.requests}
          members={overview.members}
          onDecide={pendingRequests.decide}
          onSelectMember={overview.onSelectMember}
        />
      ) : null}
      <AufRenewalCard
        translate={translate}
        renewals={summary.aufRenewals}
        onView={() => onFiltersChange({ auf: "renewal" })}
      />
      <NeedsAttention
        translate={translate}
        counts={summary.attention}
        filters={filters}
        onFiltersChange={onFiltersChange}
      />
    </>
  );
}
