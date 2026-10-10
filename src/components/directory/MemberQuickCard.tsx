"use client";

import { X } from "@phosphor-icons/react/dist/ssr/X";
import Link from "next/link";
import { useState } from "react";
import { Icon } from "@/components/Icon";
import { MemberAvatar } from "@/components/MemberAvatar";
import { describeAttendance } from "@/components/attendance/MemberAttendanceSummary";
import type { PendingRoleRequest } from "@/lib/auth/club-administration";
import type { RoleRequestDecision } from "@/lib/auth/role-request-decision";
import type { Role } from "@/lib/auth/roles";
import { memberRecordHref } from "@/lib/auth/routes";
import type {
  AdminDirectoryMember,
  DirectoryMember,
} from "@/lib/directory/directory";
import { formatCalendarDay } from "@/lib/i18n/format";
import type { Locale } from "@/lib/i18n/locale";
import type { Translator } from "@/lib/i18n/translator";
import { AdministrationNotice } from "./AdministrationNotice";
import {
  describeCountry,
  describeExperienceLevel,
  describePosition,
} from "./member-labels";
import { membershipMarkOf } from "./membership-mark";
import { InvitationBox, RoleRequestBox } from "./QuickCardAdminBoxes";
import { QuickCardContact } from "./QuickCardContact";
import { QuickCardRole } from "./QuickCardRole";
import {
  type CardTag,
  type SelectedMember,
  cardTagsOf,
  contactOf,
} from "./selected-member";
import type { PendingRoleRequests } from "./use-pending-role-requests";

/**
 * La ficha rápida de un socio en el panel lateral del directorio (#550, RF-5
 * del PRD de E21). Medidas: "Panel column", "State B" de
 * `docs/design/directorio-admin/README.md`.
 *
 * Cada rol ve lo que ya podía ver (D4): el contacto según FR-090, y lo de
 * administrar (el rol, la solicitud, la invitación, el AUF y la membresía)
 * sólo el Admin. La ficha completa también es sólo del Admin (#242), así que
 * sólo a él le enlazan el nombre y "Abrir ficha completa".
 */

/** El círculo de la ficha, en píxeles; `.directory-card-avatar` dice lo
 * mismo. */
const CARD_AVATAR_SIZE = 52;

function MemberMetaLine({
  translate,
  locale,
  member,
}: {
  translate: Translator;
  locale: Locale;
  member: DirectoryMember;
}): React.JSX.Element {
  return (
    <p className="directory-meta">
      {member.invitedOn === null
        ? `${describeCountry(translate, member.country)} · ${describeExperienceLevel(translate, member.experienceLevel)}`
        : translate("directory.invited.line", {
            date: formatCalendarDay(locale, member.invitedOn),
          })}
    </p>
  );
}

function CardHeader({
  translate,
  locale,
  member,
  isAdmin,
  onClose,
}: {
  translate: Translator;
  locale: Locale;
  member: DirectoryMember;
  isAdmin: boolean;
  onClose: () => void;
}): React.JSX.Element {
  const closeLabel = translate("directory.panel.close");
  return (
    <header className="directory-card-header">
      <MemberAvatar
        className="directory-card-avatar"
        fullName={member.fullName}
        photoUrl={member.photoUrl}
        size={CARD_AVATAR_SIZE}
        viewer={{ userId: member.userId, translate }}
      />
      <div className="directory-identity">
        <h2 className="directory-card-name">
          {isAdmin ? (
            <Link
              href={memberRecordHref(member.userId)}
              aria-label={translate("memberRecord.openLabel", {
                name: member.fullName,
              })}
            >
              {member.fullName}
            </Link>
          ) : (
            member.fullName
          )}
        </h2>
        <MemberMetaLine translate={translate} locale={locale} member={member} />
      </div>
      <button
        type="button"
        className="directory-card-close"
        aria-label={closeLabel}
        title={closeLabel}
        onClick={onClose}
      >
        <Icon glyph={X} />
      </button>
    </header>
  );
}

function CardTags({
  translate,
  tags,
}: {
  translate: Translator;
  tags: readonly CardTag[];
}): React.JSX.Element | null {
  if (tags.length === 0) {
    return null;
  }
  return (
    <ul
      className="directory-card-tags"
      aria-label={translate("directory.card.tags")}
    >
      {tags.map((tag) => (
        <li
          key={tag.text}
          className={`directory-card-tag directory-card-tag-${tag.tone}`}
        >
          {tag.text}
        </li>
      ))}
    </ul>
  );
}

type Fact = { readonly label: string; readonly value: string };

function aufFactOf(
  translate: Translator,
  locale: Locale,
  member: AdminDirectoryMember,
): string {
  if (member.aufNumber === null) {
    return translate("directory.dot.aufMissing");
  }
  if (member.aufExpiry === null) {
    return member.aufNumber;
  }
  return translate("directory.card.aufLine", {
    number: member.aufNumber,
    date: formatCalendarDay(locale, member.aufExpiry),
  });
}

function factsOf(
  translate: Translator,
  locale: Locale,
  selected: SelectedMember,
): readonly Fact[] {
  const { member } = selected;
  const shared: readonly Fact[] = [
    {
      label: translate("directory.column.attendance"),
      value: describeAttendance(translate, locale, member.attendance),
    },
    {
      label: translate("directory.column.position"),
      value: describePosition(translate, member.position),
    },
  ];
  if (selected.kind !== "admin") {
    return shared;
  }
  return [
    ...shared,
    {
      label: translate("directory.filter.auf"),
      value: aufFactOf(translate, locale, selected.member),
    },
    {
      label: translate("directory.filter.membership"),
      value: membershipMarkOf(translate, selected.member.membershipStatus).text,
    },
  ];
}

function CardFacts({
  translate,
  facts,
}: {
  translate: Translator;
  facts: readonly Fact[];
}): React.JSX.Element {
  return (
    <ul
      className="directory-card-facts"
      aria-label={translate("directory.card.facts")}
    >
      {facts.map((fact) => (
        <li key={fact.label}>
          <span className="directory-card-label">{fact.label}</span>
          <span className="directory-card-fact">{fact.value}</span>
        </li>
      ))}
    </ul>
  );
}

function requestOf(
  pendingRequests: PendingRoleRequests,
  userId: string,
): PendingRoleRequest | null {
  if (pendingRequests.state.kind !== "ready") {
    return null;
  }
  return (
    pendingRequests.state.requests.find(
      (request) => request.userId === userId,
    ) ?? null
  );
}

/** Lo que sólo ve el Admin: la invitación, la solicitud con lo que respondió
 * el servidor a la decisión tomada aquí, y el rol. */
function AdminSections({
  translate,
  locale,
  member,
  pendingRequests,
  onRoleChanged,
}: {
  translate: Translator;
  locale: Locale;
  member: AdminDirectoryMember;
  pendingRequests: PendingRoleRequests;
  onRoleChanged: (userId: string, role: Role) => void;
}): React.JSX.Element {
  // El aviso de la bandeja es de todo el club: aquí sólo se enseña el de una
  // decisión tomada desde esta ficha.
  const [hasDecidedHere, setHasDecidedHere] = useState(false);
  const request = requestOf(pendingRequests, member.userId);

  async function decide(
    decided: PendingRoleRequest,
    decision: RoleRequestDecision,
  ): Promise<void> {
    setHasDecidedHere(true);
    await pendingRequests.decide(decided, decision);
  }

  return (
    <>
      {member.invitedOn === null ? null : (
        <InvitationBox
          translate={translate}
          locale={locale}
          userId={member.userId}
          invitedOn={member.invitedOn}
          email={member.email}
        />
      )}
      {request === null ? null : (
        <RoleRequestBox
          translate={translate}
          locale={locale}
          request={request}
          onDecide={decide}
        />
      )}
      {hasDecidedHere ? (
        <AdministrationNotice notice={pendingRequests.notice} />
      ) : null}
      <QuickCardRole
        translate={translate}
        member={member}
        onRoleChanged={onRoleChanged}
      />
    </>
  );
}

export function MemberQuickCard({
  translate,
  locale,
  selected,
  pendingRequests,
  onClose,
  onRoleChanged,
}: {
  translate: Translator;
  locale: Locale;
  selected: SelectedMember;
  /** `null` para quien no es Admin: no decide solicitudes. */
  pendingRequests: PendingRoleRequests | null;
  onClose: () => void;
  onRoleChanged: (userId: string, role: Role) => void;
}): React.JSX.Element {
  const { member } = selected;
  const isAdmin = selected.kind === "admin";
  const contact = contactOf(selected);
  return (
    <>
      <CardHeader
        translate={translate}
        locale={locale}
        member={member}
        isAdmin={isAdmin}
        onClose={onClose}
      />
      <CardTags translate={translate} tags={cardTagsOf(translate, selected)} />
      {selected.kind === "admin" && pendingRequests !== null ? (
        <AdminSections
          translate={translate}
          locale={locale}
          member={selected.member}
          pendingRequests={pendingRequests}
          onRoleChanged={onRoleChanged}
        />
      ) : null}
      {contact.kind === "none" ? null : (
        <QuickCardContact
          translate={translate}
          contact={contact}
          addFor={isAdmin ? member : null}
        />
      )}
      <CardFacts
        translate={translate}
        facts={factsOf(translate, locale, selected)}
      />
      {isAdmin ? (
        <Link
          href={memberRecordHref(member.userId)}
          className="directory-card-open"
        >
          {translate("directory.card.openRecord")}
        </Link>
      ) : null}
    </>
  );
}
