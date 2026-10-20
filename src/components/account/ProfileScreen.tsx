import { SeasonAttendanceCard } from "@/components/attendance/SeasonAttendanceCard";
import type { SeasonAttendance } from "@/lib/attendance/season-attendance";
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
import { MembershipCard } from "./MembershipCard";
import { MyGroups } from "./MyGroups";
import { ProfileEvaluation } from "./ProfileEvaluation";
import { ProfileForm } from "./ProfileForm";
import { RoleCard } from "./RoleCard";

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
 * bajo ella, la franja de lo que falta son las del rediseño (#771), y a la
 * derecha de la ficha va su columna: membresía, asistencia de la temporada,
 * grupos, evaluación y rol (#774).
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
  membershipRenewsOn,
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
  /** La de la temporada (#774, D9), o null sin sesiones esta temporada. */
  attendance: SeasonAttendance | null;
  countries: readonly CountryOption[];
  /** El plan de su membresía, o null si aún no eligió (D8). */
  membershipPlan: MembershipPlan | null;
  /** El estado de su membresía, o null si no tiene (D8). */
  membershipStatus: MembershipStatus | null;
  /** YYYY-MM-DD, el próximo cobro, o null si no hay ninguno a la vista. */
  membershipRenewsOn: string | null;
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
      <div className="profile-layout">
        <div className="profile-main">
          <ProfileForm
            locale={locale}
            profile={profile}
            positionOptions={positionOptions}
            countries={countries}
            emergencyContactProposal={emergencyContactProposal}
          />
        </div>
        <div className="profile-aside">
          <MembershipCard
            translate={translate}
            headingId="mi-membresia"
            membership={{
              plan: membershipPlan,
              status: membershipStatus,
              renewsOn: membershipRenewsOn,
            }}
            hasPaymentsLink
          />
          <SeasonAttendanceCard
            translate={translate}
            attendance={attendance}
            headingId="mi-asistencia"
          />
          <MyGroups translate={translate} groups={groups} />
          <ProfileEvaluation locale={locale} evaluation={evaluation} />
          <RoleCard
            locale={locale}
            role={account.role}
            latestRequest={account.latestRequest}
          />
        </div>
      </div>
    </div>
  );
}
