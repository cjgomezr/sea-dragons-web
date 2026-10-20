import type { Metadata } from "next";
import { redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ProfileScreen } from "@/components/account/ProfileScreen";
import { readOwnSeasonAttendance } from "@/lib/attendance/own-attendance";
import type { SeasonAttendance } from "@/lib/attendance/season-attendance";
import { createSupabaseOwnSeasonAttendanceGateways } from "@/lib/attendance/supabase-season-attendance";
import { MemberNotFoundError } from "@/lib/auth/account-activation";
import {
  type RoleRequestAccount,
  describeRoleRequestAccount,
} from "@/lib/auth/role-request";
import { SIGN_IN_PATH } from "@/lib/auth/routes";
import { readAuthenticatedUserId } from "@/lib/auth/session-reader";
import { describeMissingAuthKeys } from "@/lib/auth/supabase-auth-gateways";
import {
  type ProfileEvaluation,
  readProfileEvaluation,
} from "@/lib/evaluations/profile-evaluation";
import { createSupabaseMemberEvaluationGateways } from "@/lib/evaluations/supabase-member-evaluation-gateways";
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
import {
  type MembershipPlan,
  type MembershipStatus,
  readMembership,
} from "@/lib/membership/membership";
import { nextChargeOf } from "@/lib/membership/membership-view";
import { clubCalendarDate } from "@/lib/time/club-calendar";
import { createMembershipGateway } from "@/lib/membership/supabase-membership-gateways";

/**
 * El perfil propio (#241), que antes era Mi cuenta (#209): la ficha que el
 * miembro edita (FR-084), el rol de quien la abre, los grupos a los que
 * pertenece (#229) y, si le toca, el formulario para pedir Coach o Committee
 * (FR-010), la foto de perfil (#245), su asistencia de la temporada (#774),
 * su evaluación o el aviso de que sólo la ve el personal de entrenamiento
 * (#324), y el tipo de membresía, que se cambia en Pagos (#456). La
 * dirección sigue siendo `/cuenta`, la del enlace de la cabecera.
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

/** Lo que el perfil enseña de la membresía: el plan, que se cambia en Pagos
 * (#456), el estado, que va en la cabecera (#771), y el día del próximo
 * cobro (#774). Null sin membresía. */
type MembershipSummary = {
  readonly plan: MembershipPlan | null;
  readonly status: MembershipStatus;
  readonly renewsOn: string | null;
};

/** Con la sesión: `memberships_select_own` le deja leer su propia membresía. */
async function readMembershipSummary({
  userId,
  client,
}: CallerSession): Promise<MembershipSummary | null> {
  const reading = await readMembership(createMembershipGateway(client), {
    userId,
    now: new Date(),
  });
  if (reading.kind !== "found") {
    return null;
  }
  const { membership } = reading;
  const nextCharge = nextChargeOf(membership);
  return {
    plan: membership.plan,
    status: membership.status,
    renewsOn: nextCharge === null ? null : clubCalendarDate(nextCharge),
  };
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

/** Con la llave de servicio: `authenticated` no tiene ningún privilegio sobre
 * las evaluaciones (FR-055). El dominio comprueba el rol antes de leerla, así
 * que a un Player o un Committee no se le lee ninguna. */
async function readEvaluation(userId: string): Promise<ProfileEvaluation> {
  const wiring = createSupabaseMemberEvaluationGateways(process.env);
  if (wiring.kind === "unconfigured") {
    throw new Error(describeMissingAuthKeys(wiring.missingKeys));
  }
  try {
    return await readProfileEvaluation(wiring.gateways, {
      callerId: userId,
      memberId: userId,
    });
  } catch (error) {
    // La misma carrera con la frontera que en `readAccount`.
    if (error instanceof MemberNotFoundError) {
      redirect(SIGN_IN_PATH);
    }
    throw error;
  }
}

/** Con la llave de servicio: las sesiones las lee una función de la base que
 * no se concede a `authenticated` (#746). Se lee siempre sobre quien tiene la
 * sesión, nunca sobre otro, con el día de hoy en el club (NFR-003). */
async function readAttendance(
  userId: string,
): Promise<SeasonAttendance | null> {
  const wiring = createSupabaseOwnSeasonAttendanceGateways(process.env);
  if (wiring.kind === "unconfigured") {
    throw new Error(describeMissingAuthKeys(wiring.missingKeys));
  }
  try {
    return await readOwnSeasonAttendance(wiring.gateways, {
      userId,
      today: clubCalendarDate(new Date()),
    });
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
  const [account, profile, photo, groups, evaluation, attendance, membership] =
    await Promise.all([
      readAccount(caller.userId),
      readProfile(caller),
      readPhoto(caller),
      readGroups(caller),
      readEvaluation(caller.userId),
      readAttendance(caller.userId),
      readMembershipSummary(caller),
    ]);
  return (
    <ProfileScreen
      locale={locale}
      userId={caller.userId}
      account={account}
      profile={profile.profile}
      positionOptions={profile.positionOptions}
      emergencyContactProposal={profile.emergencyContactProposal}
      photoUrl={photo.photoUrl}
      groups={groups}
      evaluation={evaluation}
      attendance={attendance}
      countries={listCountryOptions(locale)}
      membershipPlan={membership === null ? null : membership.plan}
      membershipStatus={membership === null ? null : membership.status}
      membershipRenewsOn={membership === null ? null : membership.renewsOn}
      joinedOn={profile.joinedOn}
    />
  );
}
