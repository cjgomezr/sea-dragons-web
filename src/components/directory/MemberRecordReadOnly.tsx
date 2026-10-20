import { type HeroMember, ProfileHero } from "@/components/account/ProfileHero";
import {
  ContactSummary,
  type ReachableAt,
} from "@/components/account/ContactSummary";
import { EditableCard } from "@/components/account/EditableCard";
import { MembershipCard } from "@/components/account/MembershipCard";
import { GroupChips } from "@/components/account/MyGroups";
import { SideCard } from "@/components/account/SideCard";
import { SeasonAttendanceCard } from "@/components/attendance/SeasonAttendanceCard";
import type { Locale } from "@/lib/i18n/locale";
import { type Translator, createTranslator } from "@/lib/i18n/translator";
import type { StaffMemberRecord } from "@/lib/members/member-record";
import { MemberRecordAbout } from "./MemberRecordAbout";
import { MemberRecordActions } from "./MemberRecordActions";

/**
 * La ficha de un socio en lectura para el Committee y el Coach (#776, D1 y D3
 * del PRD de E30): la misma disposición que la del Admin, sin nada que se
 * edite y sin lo que no les toca. Ni el AUF, ni la Ficha del club, ni la
 * evaluación, ni el ⋯.
 *
 * Qué sale lo decide la vista que trajo la API, no el rol que la pantalla
 * pudiera leer por su cuenta: una tarjeta cuyo bloque no llegó no se pinta,
 * en vez de pintarse vacía. Por eso el Coach, que no recibe el correo ni el
 * teléfono, lee en Contacto sólo el de emergencia, y nadie lee "Miembro
 * desde": la fecha de alta no llega a estas vistas (#770).
 */

function heroMemberOf(record: StaffMemberRecord): HeroMember {
  return {
    userId: record.userId,
    fullName: record.fullName,
    role: record.role,
    positionNames: record.positionName,
    experienceLevel: record.experienceLevel,
    country: record.country,
    membershipStatus: record.membershipStatus,
    auf: null,
    joinedOn: null,
    photoUrl: record.photoUrl,
  };
}

function reachableAtOf(record: StaffMemberRecord): ReachableAt | null {
  return record.view === "committee"
    ? { phone: record.phone, email: record.email }
    : null;
}

function ReadOnlyContact({
  translate,
  record,
}: {
  translate: Translator;
  record: StaffMemberRecord;
}): React.JSX.Element {
  return (
    <EditableCard
      translate={translate}
      headingId="ficha-contacto"
      title={translate("memberRecord.contact.title")}
      isEditing={false}
      focusFieldId=""
      savedText={null}
      onEdit={null}
    >
      <ContactSummary
        translate={translate}
        reachableAt={reachableAtOf(record)}
        emergencyContact={record.emergencyContact}
      />
    </EditableCard>
  );
}

/** La columna derecha: Membresía, la asistencia de la temporada y Grupos,
 * sin Editar. */
function ReadOnlyAside({
  translate,
  record,
}: {
  translate: Translator;
  record: StaffMemberRecord;
}): React.JSX.Element {
  return (
    <div className="profile-aside">
      <MembershipCard
        translate={translate}
        headingId="ficha-plan"
        membership={{
          plan: record.membershipPlan,
          status: record.membershipStatus,
          renewsOn: record.membershipRenewsOn,
        }}
        hasPaymentsLink={false}
      />
      <SeasonAttendanceCard
        translate={translate}
        attendance={record.attendance}
        headingId="ficha-asistencia"
      />
      <SideCard
        headingId="ficha-grupos"
        title={translate("profileAside.groups.title")}
      >
        <GroupChips translate={translate} groups={record.groups} />
      </SideCard>
    </div>
  );
}

export function MemberRecordReadOnly({
  locale,
  record,
}: {
  locale: Locale;
  record: StaffMemberRecord;
}): React.JSX.Element {
  const translate = createTranslator(locale);
  return (
    <>
      <ProfileHero
        locale={locale}
        isOwnProfile={false}
        member={heroMemberOf(record)}
        actions={
          <MemberRecordActions
            translate={translate}
            reading={record}
            adminMenu={null}
          />
        }
      />
      <div className="profile-layout">
        <div className="profile-main">
          <MemberRecordAbout translate={translate} record={record} />
          <ReadOnlyContact translate={translate} record={record} />
        </div>
        <ReadOnlyAside translate={translate} record={record} />
      </div>
    </>
  );
}
