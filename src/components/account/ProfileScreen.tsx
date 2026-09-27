import type { RoleRequestAccount } from "@/lib/auth/role-request";
import type { ProfileEvaluation as Evaluation } from "@/lib/evaluations/profile-evaluation";
import type { CountryOption } from "@/lib/geo/countries";
import type { MemberGroup } from "@/lib/groups/member-groups";
import type { Locale } from "@/lib/i18n/locale";
import type { ClubPositions } from "@/lib/club/club-positions";
import type { OwnProfile } from "@/lib/members/own-profile";
import { AccountHeader } from "./AccountHeader";
import { MyGroups } from "./MyGroups";
import { ProfileEvaluation } from "./ProfileEvaluation";
import { ProfileForm } from "./ProfileForm";
import { RoleRequestPanel } from "./RoleRequestPanel";

/** El perfil propio (#241): Mi cuenta convertida en perfil. La cabecera, la
 * ficha editable y, debajo, lo que Mi cuenta ya enseñaba (#209, #229), con
 * la evaluación o el aviso de que es privada (#324). La página lee los
 * datos; esto sólo los coloca. */
export function ProfileScreen({
  locale,
  userId,
  account,
  profile,
  positionOptions,
  photoUrl,
  groups,
  evaluation,
  countries,
}: {
  locale: Locale;
  /** El `user_id` de quien mira su perfil. */
  userId: string;
  account: RoleRequestAccount;
  profile: OwnProfile;
  /** Las posiciones del club que se le ofrecen, en su orden (#299). */
  positionOptions: ClubPositions;
  /** La dirección firmada de la foto (#245), o null sin foto. */
  photoUrl: string | null;
  groups: readonly MemberGroup[];
  evaluation: Evaluation;
  countries: readonly CountryOption[];
}): React.JSX.Element {
  return (
    <div className="account">
      <AccountHeader
        locale={locale}
        userId={userId}
        fullName={account.fullName}
        role={account.role}
        photoUrl={photoUrl}
      />
      <ProfileForm
        locale={locale}
        profile={profile}
        positionOptions={positionOptions}
        countries={countries}
      />
      <MyGroups locale={locale} groups={groups} />
      <ProfileEvaluation locale={locale} evaluation={evaluation} />
      <RoleRequestPanel
        locale={locale}
        role={account.role}
        latestRequest={account.latestRequest}
      />
    </div>
  );
}
