import type { RoleRequestAccount } from "@/lib/auth/role-request";
import type { CountryOption } from "@/lib/geo/countries";
import type { MemberGroup } from "@/lib/groups/member-groups";
import type { Locale } from "@/lib/i18n/locale";
import type { OwnProfile } from "@/lib/members/own-profile";
import { AccountHeader } from "./AccountHeader";
import { MyGroups } from "./MyGroups";
import { ProfileForm } from "./ProfileForm";
import { RoleRequestPanel } from "./RoleRequestPanel";

/** El perfil propio (#241): Mi cuenta convertida en perfil. La cabecera, la
 * ficha editable y, debajo, lo que Mi cuenta ya enseñaba (#209, #229). La
 * página lee los datos; esto sólo los coloca. */
export function ProfileScreen({
  locale,
  account,
  profile,
  groups,
  countries,
}: {
  locale: Locale;
  account: RoleRequestAccount;
  profile: OwnProfile;
  groups: readonly MemberGroup[];
  countries: readonly CountryOption[];
}): React.JSX.Element {
  return (
    <div className="account">
      <AccountHeader
        locale={locale}
        fullName={account.fullName}
        role={account.role}
      />
      <ProfileForm locale={locale} profile={profile} countries={countries} />
      <MyGroups locale={locale} groups={groups} />
      <RoleRequestPanel
        locale={locale}
        role={account.role}
        latestRequest={account.latestRequest}
      />
    </div>
  );
}
