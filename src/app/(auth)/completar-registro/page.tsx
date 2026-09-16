import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { CompleteRegistrationForm } from "@/components/auth/CompleteRegistrationForm";
import { MemberNotFoundError } from "@/lib/auth/account-activation";
import {
  type AccountCompletion,
  describeAccountCompletion,
} from "@/lib/auth/complete-registration";
import { DASHBOARD_PATH, SIGN_IN_PATH } from "@/lib/auth/routes";
import { readAuthenticatedCaller } from "@/lib/auth/session-reader";
import {
  createSupabaseAuthGateways,
  describeMissingAuthKeys,
} from "@/lib/auth/supabase-auth-gateways";
import { listCountryOptions } from "@/lib/geo/countries";
import { readRequestLocale } from "@/lib/i18n/request-locale";
import { createTranslator } from "@/lib/i18n/translator";
import { readServerCookies } from "@/lib/supabase/server-cookies";
import { createSessionClient } from "@/lib/supabase/session-client";

/**
 * La pantalla de una cuenta `incomplete` (FR-083).
 *
 * Quién puede verla lo decide la frontera de sesión, no esta página: una
 * cuenta activa que la pide a mano acaba en el panel antes de llegar aquí, y
 * una sin sesión acaba en la entrada. Lo que la página resuelve es QUÉ pedir,
 * y lo pregunta a la misma función que decide el paso a `active`.
 */

export async function generateMetadata(): Promise<Metadata> {
  const translate = createTranslator(await readRequestLocale());
  return {
    title: translate("auth.completion.metaTitle"),
    description: translate("auth.completion.metaDescription"),
  };
}

export default async function CompleteRegistrationPage(): Promise<React.JSX.Element> {
  const session = createSessionClient(process.env, await readServerCookies());
  if (session.kind === "unconfigured") {
    throw new Error(describeMissingAuthKeys(session.missingKeys));
  }

  const caller = await readAuthenticatedCaller(session.client);
  if (caller === null) {
    redirect(SIGN_IN_PATH);
  }

  const wiring = createSupabaseAuthGateways(process.env);
  if (wiring.kind === "unconfigured") {
    throw new Error(describeMissingAuthKeys(wiring.missingKeys));
  }

  let completion: AccountCompletion;
  try {
    completion = await describeAccountCompletion(
      {
        accounts: wiring.gateways.accounts,
        identities: wiring.gateways.identities,
      },
      { userId: caller.userId },
    );
  } catch (error) {
    // Una identidad sin fila de socio no es un fallo del servidor: es alguien
    // a quien esta aplicación no puede servir, y la entrada es el sitio desde
    // donde volver. La frontera ya lo trata igual; aquí sólo se llega en una
    // carrera con ella.
    if (error instanceof MemberNotFoundError) {
      redirect(SIGN_IN_PATH);
    }
    throw error;
  }

  // Consultar la cuenta la reconcilia, así que puede volver ya activa. Quien
  // no tiene nada que completar no se queda mirando esta pantalla.
  if (completion.accountStatus !== "incomplete") {
    redirect(DASHBOARD_PATH);
  }

  const locale = await readRequestLocale();
  return (
    <CompleteRegistrationForm
      locale={locale}
      pending={completion.pending}
      countries={listCountryOptions(locale)}
      email={caller.email}
    />
  );
}
