import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AccountHeader } from "@/components/account/AccountHeader";
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
import { readRequestLocale } from "@/lib/i18n/request-locale";
import { createTranslator } from "@/lib/i18n/translator";
import { readServerCookies } from "@/lib/supabase/server-cookies";
import { createSessionClient } from "@/lib/supabase/session-client";

/**
 * Mi cuenta (#209): el rol de quien la abre y, si le toca, el formulario para
 * pedir Coach o Committee (FR-010). E5 la convertirá en el perfil.
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

async function readCallerId(): Promise<string> {
  const session = createSessionClient(process.env, await readServerCookies());
  if (session.kind === "unconfigured") {
    throw new Error(describeMissingAuthKeys(session.missingKeys));
  }
  const userId = await readAuthenticatedUserId(session.client);
  if (userId === null) {
    redirect(SIGN_IN_PATH);
  }
  return userId;
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
  const [locale, account] = await Promise.all([
    readRequestLocale(),
    readCallerId().then(readAccount),
  ]);
  return (
    <div className="account">
      <AccountHeader
        locale={locale}
        fullName={account.fullName}
        role={account.role}
      />
      <RoleRequestPanel
        locale={locale}
        role={account.role}
        latestRequest={account.latestRequest}
      />
    </div>
  );
}
