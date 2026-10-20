"use client";

import Link from "next/link";
import { MemberAvatar } from "@/components/MemberAvatar";
import type { Role } from "@/lib/auth/roles";
import { memberRecordHref } from "@/lib/auth/routes";
import type { Locale } from "@/lib/i18n/locale";
import type { Translator } from "@/lib/i18n/translator";
import { BottomSheet } from "./BottomSheet";
import { ContactActions } from "./ContactActions";
import {
  AdminSections,
  CardFacts,
  CardTags,
  type Fact,
  MemberMetaLine,
  adminFactsOf,
  attendanceFactOf,
  positionFactOf,
} from "./MemberQuickCard";
import {
  type SelectedMember,
  canOpenRecord,
  cardTagsOf,
  contactOf,
} from "./selected-member";
import type { PendingRoleRequests } from "./use-pending-role-requests";

/**
 * La ficha del socio en el móvil (#554, RF-8 del PRD de E21): la ficha
 * rápida del panel lateral (#550), pero en una hoja que sube desde abajo
 * sobre la lista oscurecida. Medidas: "2b, Phone", punto 3, de
 * `docs/design/directorio-admin/README.md`.
 *
 * Cambia lo que en la piscina se usa con una mano: el contacto son tres
 * botones redondos que llaman o escriben, en vez de líneas que se copian.
 * Lo demás es la misma ficha, con lo mismo para cada rol (D4): el rol, la
 * invitación, la solicitud, el AUF y la membresía, sólo para el Admin. La
 * ficha completa la abren también el Committee y el Coach, en lectura
 * (#776).
 */

/** El círculo de la ficha, en píxeles; `.directory-sheet-avatar` dice lo
 * mismo. */
const SHEET_AVATAR_SIZE = 54;

/** El Admin ve el AUF y la membresía en el sitio de la posición: la fila ya
 * la dice debajo del nombre. */
function sheetFactsOf(
  translate: Translator,
  locale: Locale,
  selected: SelectedMember,
): readonly Fact[] {
  const attendance = attendanceFactOf(translate, locale, selected.member);
  return selected.kind === "admin"
    ? [attendance, ...adminFactsOf(translate, locale, selected.member)]
    : [attendance, positionFactOf(translate, selected.member)];
}

function SheetHeader({
  translate,
  locale,
  titleId,
  selected,
}: {
  translate: Translator;
  locale: Locale;
  titleId: string;
  selected: SelectedMember;
}): React.JSX.Element {
  const { member } = selected;
  return (
    <header className="directory-card-header">
      <MemberAvatar
        className="directory-sheet-avatar"
        fullName={member.fullName}
        photoUrl={member.photoUrl}
        size={SHEET_AVATAR_SIZE}
        viewer={{ userId: member.userId, translate }}
      />
      <div className="directory-identity">
        <h2 id={titleId} className="directory-card-name">
          {member.fullName}
        </h2>
        <MemberMetaLine translate={translate} locale={locale} member={member} />
      </div>
    </header>
  );
}

export function MemberSheet({
  translate,
  locale,
  selected,
  pendingRequests,
  onClosed,
  onRoleChanged,
}: {
  translate: Translator;
  locale: Locale;
  selected: SelectedMember;
  /** `null` para quien no es Admin: no decide solicitudes. */
  pendingRequests: PendingRoleRequests | null;
  onClosed: () => void;
  onRoleChanged: (userId: string, role: Role) => void;
}): React.JSX.Element {
  const { member } = selected;
  const contact = contactOf(selected);
  return (
    <BottomSheet
      title={(titleId) => (
        <SheetHeader
          translate={translate}
          locale={locale}
          titleId={titleId}
          selected={selected}
        />
      )}
      gripLabel={translate("directory.sheet.close")}
      onClosed={onClosed}
    >
      {() => (
        <>
          <CardTags
            translate={translate}
            tags={cardTagsOf(translate, selected)}
          />
          {contact.kind === "none" ? null : (
            <ContactActions
              translate={translate}
              contact={contact}
              fullName={member.fullName}
              label={translate("directory.card.contact")}
              className="directory-sheet-contact"
            />
          )}
          {selected.kind === "admin" && pendingRequests !== null ? (
            <AdminSections
              translate={translate}
              locale={locale}
              member={selected.member}
              pendingRequests={pendingRequests}
              onRoleChanged={onRoleChanged}
            />
          ) : null}
          <CardFacts
            translate={translate}
            facts={sheetFactsOf(translate, locale, selected)}
          />
          {canOpenRecord(selected) ? (
            <Link
              href={memberRecordHref(member.userId)}
              className="directory-sheet-open"
            >
              {translate("directory.card.openRecord")}
            </Link>
          ) : null}
        </>
      )}
    </BottomSheet>
  );
}
