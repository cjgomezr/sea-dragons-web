import { MemberAttendanceSummary } from "@/components/attendance/MemberAttendanceSummary";
import type { MemberAttendance } from "@/lib/attendance/attendance-stats";
import type { RoleRequestAccount } from "@/lib/auth/role-request";
import type { ProfileEvaluation as Evaluation } from "@/lib/evaluations/profile-evaluation";
import type { CountryOption } from "@/lib/geo/countries";
import type { MemberGroup } from "@/lib/groups/member-groups";
import type { Locale } from "@/lib/i18n/locale";
import { createTranslator } from "@/lib/i18n/translator";
import type { ClubPositions } from "@/lib/club/club-positions";
import { isAufExpired } from "@/lib/members/member-record";
import type {
  EmergencyContactProposal,
  OwnAuf,
  OwnProfile,
} from "@/lib/members/own-profile";
import { clubCalendarDate } from "@/lib/time/club-calendar";
import { profileCompletenessOf } from "@/lib/members/contact-reminder";
import type {
  MembershipPlan,
  MembershipStatus,
} from "@/lib/membership/membership";
import { type HeroAuf, ProfileHero } from "./ProfileHero";
import { ProfileCompletionStrip } from "./ProfileCompletionStrip";
import { MembershipTypeSummary } from "./MembershipTypeSummary";
import { MyGroups } from "./MyGroups";
import { ProfileEvaluation } from "./ProfileEvaluation";
import { ProfileForm } from "./ProfileForm";
import { RoleRequestPanel } from "./RoleRequestPanel";

/** Sin AUF no hay ficha. Vencido se mira hoy en el club, como la ficha del
 * Admin. */
function heroAufOf(auf: OwnAuf): HeroAuf | null {
  if (auf.status === "none") {
    return null;
  }
  return {
    isVerified: auf.status === "verified",
    isExpired: isAufExpired(auf.expiry, clubCalendarDate(new Date())),
  };
}

/** El perfil propio (#241): Mi cuenta convertida en perfil. La cabecera, la
 * ficha editable y, debajo, lo que Mi cuenta ya enseñaba (#209, #229), con
 * su asistencia (#396) y la evaluación o el aviso de que es privada (#324).
 * El tipo de membresía se ve, pero se cambia en Pagos (#456). La cabecera y,
 * bajo ella, la franja de lo que falta son las del rediseño (#771).
 * La página lee los datos; esto sólo los coloca. */
export function ProfileScreen({
  locale,
  userId,
  account,
  profile,
  positionOptions,
  emergencyContactProposal,
  photoUrl,
  groups,
  evaluation,
  attendance,
  countries,
  membershipPlan,
  membershipStatus,
  joinedOn,
}: {
  locale: Locale;
  /** El `user_id` de quien mira su perfil. */
  userId: string;
  account: RoleRequestAccount;
  profile: OwnProfile;
  /** Las posiciones del club que se le ofrecen, en su orden (#299). */
  positionOptions: ClubPositions;
  /** El tutor que se propone como contacto de emergencia (#496). */
  emergencyContactProposal: EmergencyContactProposal | null;
  /** La dirección firmada de la foto (#245), o null sin foto. */
  photoUrl: string | null;
  groups: readonly MemberGroup[];
  evaluation: Evaluation;
  attendance: MemberAttendance;
  countries: readonly CountryOption[];
  /** El plan de su membresía, o null si aún no eligió (D8). */
  membershipPlan: MembershipPlan | null;
  /** El estado de su membresía, o null si no tiene (D8). */
  membershipStatus: MembershipStatus | null;
  /** YYYY-MM-DD, el día en que ingresó. */
  joinedOn: string;
}): React.JSX.Element {
  const translate = createTranslator(locale);
  const position = positionOptions.find(
    (option) => option.id === profile.positionId,
  );
  return (
    <div className="account">
      <ProfileHero
        locale={locale}
        isOwnProfile
        member={{
          userId,
          fullName: account.fullName,
          role: account.role,
          positionNames: position === undefined ? null : position.names,
          experienceLevel: profile.experienceLevel,
          country: profile.country,
          membershipStatus,
          auf: heroAufOf(profile.auf),
          joinedOn,
          photoUrl,
        }}
      />
      <ProfileCompletionStrip
        locale={locale}
        completeness={profileCompletenessOf(profile)}
      />
      <ProfileForm
        locale={locale}
        profile={profile}
        positionOptions={positionOptions}
        countries={countries}
        emergencyContactProposal={emergencyContactProposal}
      />
      <MembershipTypeSummary translate={translate} plan={membershipPlan} />
      <MyGroups locale={locale} groups={groups} />
      {/* La misma tarjeta que Mis grupos y la evaluación: la clase es la de
          esa tarjeta, no dice qué lleva dentro. */}
      <MemberAttendanceSummary
        translate={translate}
        locale={locale}
        attendance={attendance}
        headingId="mi-asistencia"
        className="account-evaluation"
      />
      <ProfileEvaluation locale={locale} evaluation={evaluation} />
      <RoleRequestPanel
        locale={locale}
        role={account.role}
        latestRequest={account.latestRequest}
      />
    </div>
  );
}
