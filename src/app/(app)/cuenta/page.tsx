import type { Metadata } from "next";
import { redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AccountHeader } from "@/components/account/AccountHeader";
import { MyGroups } from "@/components/account/MyGroups";
import { RoleRequestPanel } from "@/components/account/RoleRequestPanel";
import { MemberNotFoundError } from "@/lib/auth/account-activation";
import {
  type RoleRequestAccount,
  describeRoleRequestAccount,
} from "@/lib/auth/role-request";
import { SIGN_IN_PATH } from "@/lib/auth/routes";
import { readAuthenticatedUserId } from "@/lib/auth/session-reader";
import { describeMissingAuthKeys } from "@/lib/auth/supabase-auth-gateways";
import { createSupabaseRoleRequestGateways } from "@/lib/auth/supabase-role-request-gateways";
import { type MemberGroup, listMemberGroups } from "@/lib/groups/member-groups";
import { createSupabaseMemberGroupsGateway } from "@/lib/groups/supabase-member-groups-gateway";
import { readRequestLocale } from "@/lib/i18n/request-locale";
import { createTranslator } from "@/lib/i18n/translator";
import { readServerCookies } from "@/lib/supabase/server-cookies";
import { createSessionClient } from "@/lib/supabase/session-client";

/**
 * Mi cuenta (#209): el rol de quien la abre, los grupos a los que pertenece
 * (#229) y, si le toca, el formulario para pedir Coach o Committee (FR-010).
 * E5 la convertirá en el perfil.
 *
 * Quién llega lo decide la frontera: cualquier cuenta activa, de cualquier
 * rol. Una incompleta acaba en completar registro y una sin sesión en la
 * entrada, antes de llegar aquí.
 */

export async function generateMetadata(): Promise<Metadata> {
  const translate = createTranslator(await readRequestLocale());
  return {
    title: translate("account.metaTitle"),
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
  const [account, groups] = await Promise.all([
    readAccount(caller.userId),
    readGroups(caller),
  ]);
  return (
    <div className="account">
      <AccountHeader
        locale={locale}
        fullName={account.fullName}
        role={account.role}
      />
      <MyGroups locale={locale} groups={groups} />
      <RoleRequestPanel
        locale={locale}
        role={account.role}
        latestRequest={account.latestRequest}
      />
    </div>
  );
}
