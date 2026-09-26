import type { Metadata } from "next";
import { redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ProfileScreen } from "@/components/account/ProfileScreen";
import { MemberNotFoundError } from "@/lib/auth/account-activation";
import {
  type RoleRequestAccount,
  describeRoleRequestAccount,
} from "@/lib/auth/role-request";
import { SIGN_IN_PATH } from "@/lib/auth/routes";
import { readAuthenticatedUserId } from "@/lib/auth/session-reader";
import { describeMissingAuthKeys } from "@/lib/auth/supabase-auth-gateways";
import { createSupabaseRoleRequestGateways } from "@/lib/auth/supabase-role-request-gateways";
import { listCountryOptions } from "@/lib/geo/countries";
import { type MemberGroup, listMemberGroups } from "@/lib/groups/member-groups";
import { createSupabaseMemberGroupsGateway } from "@/lib/groups/supabase-member-groups-gateway";
import { readMetadataContext } from "@/lib/club/metadata-context";
import { readRequestLocale } from "@/lib/i18n/request-locale";
import {
  type OwnProfileScreen,
  readOwnProfile,
} from "@/lib/members/own-profile";
import { cachedClubPositions } from "@/lib/club/supabase-club-positions";
import {
  type ProfilePhoto,
  readProfilePhoto,
} from "@/lib/members/profile-photo";
import { createOwnProfileGateways } from "@/lib/members/supabase-own-profile-gateways";
import { createSupabaseProfilePhotoGateways } from "@/lib/members/supabase-profile-photo-gateways";
import { readServerCookies } from "@/lib/supabase/server-cookies";
import { createSessionClient } from "@/lib/supabase/session-client";

/**
 * El perfil propio (#241), que antes era Mi cuenta (#209): la ficha que el
 * miembro edita (FR-084), el rol de quien la abre, los grupos a los que
 * pertenece (#229) y, si le toca, el formulario para pedir Coach o Committee
 * (FR-010), y la foto de perfil (#245). La dirección sigue siendo `/cuenta`,
 * la del enlace de la cabecera.
 *
 * Quién llega lo decide la frontera: cualquier cuenta activa, de cualquier
 * rol. Una incompleta acaba en completar registro y una sin sesión en la
 * entrada, antes de llegar aquí.
 */

export async function generateMetadata(): Promise<Metadata> {
  const { translate, club } = await readMetadataContext();
  return {
    title: translate("account.metaTitle", { club }),
    description: translate("account.metaDescription"),
  };
}

type CallerSession = {
  readonly userId: string;
  readonly client: SupabaseClient;
};

async function readCallerSession(): Promise<CallerSession> {
  const session = createSessionClient(process.env, await readServerCookies());
  if (session.kind === "unconfigured") {
    throw new Error(describeMissingAuthKeys(session.missingKeys));
  }
  const userId = await readAuthenticatedUserId(session.client);
  if (userId === null) {
    redirect(SIGN_IN_PATH);
  }
  return { userId, client: session.client };
}

/** Con la sesión del socio y no con la llave de servicio: la RLS de
 * `0015_groups.sql` ya le deja ver sólo sus grupos. */
function readGroups({
  userId,
  client,
}: CallerSession): Promise<readonly MemberGroup[]> {
  return listMemberGroups(createSupabaseMemberGroupsGateway(client), userId);
}

/** También con la sesión: `members_select_own` le deja leer su propia fila,
 * y la llave de servicio sólo hace falta para escribirla. Las posiciones de su
 * club salen de la caché (#299). */
async function readProfile({
  userId,
  client,
}: CallerSession): Promise<OwnProfileScreen> {
  try {
    return await readOwnProfile(
      createOwnProfileGateways(client, cachedClubPositions),
      userId,
    );
  } catch (error) {
    // La misma carrera con la frontera que en `readAccount`.
    if (error instanceof MemberNotFoundError) {
      redirect(SIGN_IN_PATH);
    }
    throw error;
  }
}

/** La foto se firma con la llave de servicio: el bucket es privado (#245). */
async function readPhoto({
  userId,
  client,
}: CallerSession): Promise<ProfilePhoto> {
  const wiring = createSupabaseProfilePhotoGateways(process.env, client);
  if (wiring.kind === "unconfigured") {
    throw new Error(describeMissingAuthKeys(wiring.missingKeys));
  }
  try {
    return await readProfilePhoto(wiring.gateways, userId);
  } catch (error) {
    // La misma carrera con la frontera que en `readAccount`.
    if (error instanceof MemberNotFoundError) {
      redirect(SIGN_IN_PATH);
    }
    throw error;
  }
}

async function readAccount(userId: string): Promise<RoleRequestAccount> {
  const wiring = createSupabaseRoleRequestGateways(process.env);
  if (wiring.kind === "unconfigured") {
    throw new Error(describeMissingAuthKeys(wiring.missingKeys));
  }
  try {
    return await describeRoleRequestAccount(wiring.gateways, userId);
  } catch (error) {
    // Una identidad sin fila de socio sólo llega aquí en una carrera con la
    // frontera, que ya la trata como a quien no tiene sesión.
    if (error instanceof MemberNotFoundError) {
      redirect(SIGN_IN_PATH);
    }
    throw error;
  }
}

export default async function AccountPage(): Promise<React.JSX.Element> {
  const [locale, caller] = await Promise.all([
    readRequestLocale(),
    readCallerSession(),
  ]);
  const [account, profile, photo, groups] = await Promise.all([
    readAccount(caller.userId),
    readProfile(caller),
    readPhoto(caller),
    readGroups(caller),
  ]);
  return (
    <ProfileScreen
      locale={locale}
      userId={caller.userId}
      account={account}
      profile={profile.profile}
      positionOptions={profile.positionOptions}
      photoUrl={photo.photoUrl}
      groups={groups}
      countries={listCountryOptions(locale)}
    />
  );
}
