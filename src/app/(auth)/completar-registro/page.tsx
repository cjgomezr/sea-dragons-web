import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { CompleteRegistrationForm } from "@/components/auth/CompleteRegistrationForm";
import { describeAccountCompletion } from "@/lib/auth/complete-registration";
import { SIGN_IN_PATH } from "@/lib/auth/routes";
import { readAuthenticatedCaller } from "@/lib/auth/session-reader";
import {
  createSupabaseAuthGateways,
  describeMissingAuthKeys,
} from "@/lib/auth/supabase-auth-gateways";
import { listCountryOptions } from "@/lib/geo/countries";
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

export const metadata: Metadata = {
  title: "Termina tu registro · Victoria Seadragons",
  description:
    "Completa los datos que le faltan a tu cuenta del club Victoria Seadragons.",
};

const PAGE_LOCALE = "es";

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

  const { pending } = await describeAccountCompletion(
    {
      accounts: wiring.gateways.accounts,
      identities: wiring.gateways.identities,
    },
    { userId: caller.userId, now: new Date() },
  );

  return (
    <CompleteRegistrationForm
      pending={pending}
      countries={listCountryOptions(PAGE_LOCALE)}
      email={caller.email}
    />
  );
}
